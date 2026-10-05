import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Load actual server modules with isolated dependencies: no real torrents,
// credentials or external mutations are required for these regression tests.
function moduleAt(file, dependencies) {
	const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	});
	const exports = {};
	new Function('require', 'exports', 'fetch', 'console', outputText)(
		(name) => {
			if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
			return dependencies[name];
		},
		exports,
		dependencies.fetch,
		{ log() {}, warn() {}, error() {} }
	);
	return exports;
}

function torrentModule(fetch) {
	return moduleAt('src/lib/server/sources/torrserver.ts', {
		'$lib/server/config': {
			config: { torrents: { enabled: true, apiKey: 'private-test-key' } },
			getTorrentServerUrl: async () => 'https://vps.example',
			tmdb: { brief: async () => null }
		},
		fetch
	});
}

const target = { type: 'movie', tmdbId: 550 };

test('network failure is an upstream error, not an absent film', async () => {
	const mod = torrentModule(async () => { throw new TypeError('fetch failed'); });
	await assert.rejects(mod.torrentPlaybackSource(target), mod.TorrentServerUnavailableError);
});

test('rejected VPS API key is an upstream error', async () => {
	const mod = torrentModule(async () => new Response('', { status: 403 }));
	await assert.rejects(mod.torrentPlaybackSource(target), mod.TorrentServerUnavailableError);
});

test('healthy VPS receives a private header; missing title remains not found', async () => {
	const requests = [];
	const mod = torrentModule(async (url, init) => {
		requests.push({ url, init });
		return Response.json(url.endsWith('/gst/settings') ? { built_in: true } : []);
	});
	assert.equal(await mod.torrentPlaybackSource(target), null);
	assert.ok(requests.length >= 2);
	for (const { url, init } of requests) {
		assert.equal(init.headers.get('X-Kihema-Key'), 'private-test-key');
		assert.ok(!url.includes('private-test-key'));
	}
});

function resolveModule(torrentPlaybackSource, TorrentServerUnavailableError) {
	return moduleAt('src/routes/api/playback/resolve/+server.ts', {
		'@sveltejs/kit': {
			json: Response.json,
			error(status, message) { throw Object.assign(new Error(message), { status }); }
		},
		'$lib/server/archive': { findArchiveFilm: () => null },
		'$lib/server/config': {
			config: { demoMode: false, torrents: { enabled: true } },
			getTorrentServerUrl: async () => 'https://vps.example',
			libraryIndex: { findMovie: () => undefined },
			jellyfinAnon: null
		},
		'$lib/server/demo-data': {},
		'$lib/server/introdb': { getIntroDbSegments: async () => [], mergeMediaSegments: () => [] },
		'$lib/server/session': { readSession: () => null },
		'$lib/server/sources/torrserver': { torrentPlaybackSource, TorrentServerUnavailableError }
	});
}

const requestContext = () => ({ request: { json: async () => target }, cookies: {} });

test('resolve exposes VPS failure as HTTP 503', async () => {
	const { TorrentServerUnavailableError } = torrentModule(() => {});
	const route = resolveModule(async () => {
		throw new TorrentServerUnavailableError('offline');
	}, TorrentServerUnavailableError);
	await assert.rejects(route.POST(requestContext()), { status: 503 });
});

test('resolve still returns HTTP 404 for genuinely missing sources', async () => {
	const { TorrentServerUnavailableError } = torrentModule(() => {});
	const route = resolveModule(async () => null, TorrentServerUnavailableError);
	await assert.rejects(route.POST(requestContext()), { status: 404 });
});

test('a failed first candidate does not discard later-ready alternatives', async () => {
	const a = 'a'.repeat(40);
	const b = 'b'.repeat(40);
	let added = false;
	let firstFailed = false;
	const tried = [];
	const removed = [];
	const mod = moduleAt('src/lib/server/sources/torrserver.ts', {
		'$lib/server/config': {
			config: { torrents: { enabled: true, apiKey: 'private-test-key', jackettUrl: 'https://search.example' } },
			getTorrentServerUrl: async () => 'https://vps.example',
			tmdb: { brief: async () => ({ title: 'Film', originalTitle: 'Film', year: 2020 }), externalIds: async () => ({}) }
		},
		fetch: async (url, init = {}) => {
			url = String(url);
			if (url.endsWith('/gst/settings')) return Response.json({ built_in: true });
			if (url.startsWith('https://search.example')) return Response.json({ Results: [
				{ Title: 'Film.2020.1080p.x264.mkv', Seeders: 80, MagnetUri: `magnet:?xt=urn:btih:${a}` },
				{ Title: 'Film.2020.720p.x264.mkv', Seeders: 20, MagnetUri: `magnet:?xt=urn:btih:${b}` }
			] });
			if (url.endsWith('/torrents')) {
				const body = JSON.parse(init.body);
				if (body.action === 'add') added = true;
				if (body.action === 'rem') removed.push(body.hash);
				if (body.action !== 'list') return Response.json({});
				if (!added) return Response.json([]);
				const files = (path) => JSON.stringify({ TorrServer: { Files: [{ id: 1, path, length: 1000 }] } });
				return Response.json([
					{ hash: a, title: 'Film A', data: files('a.mkv') },
					{ hash: b, title: 'Film B', data: firstFailed ? files('b.mkv') : '{}' }
				]);
			}
			if (url.includes('/master.m3u8')) {
				const hash = new URL(url).pathname.split('/')[2];
				tried.push(hash);
				if (hash === a) {
					firstFailed = true;
					return new Response('unsupported video codec', { status: 502 });
				}
				return new Response('#EXTM3U\nvideo.m3u8');
			}
			if (url.includes('/probe')) return Response.json({ Tracks: [{ Type: 'audio', Language: 'ru' }] });
			throw new Error(`Unexpected fetch: ${url}`);
		}
	});
	const source = await mod.torrentPlaybackSource(target);
	assert.equal(source.mediaSourceId, b);
	assert.deepEqual(tried, [a, b]);
	assert.deepEqual(removed, [a]);
});
