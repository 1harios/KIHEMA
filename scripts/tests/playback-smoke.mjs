import assert from 'node:assert/strict';

const [base = 'https://kihema.vercel.app', type = 'movie', id = '550', season = '1', episode = '1'] = process.argv.slice(2);
const target = { type, tmdbId: Number(id), ...(type === 'show' ? { season: Number(season), episode: Number(episode) } : {}) };
const started = Date.now();
const res = await fetch(`${base}/api/playback/resolve`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(target),
	signal: AbortSignal.timeout(150_000)
});
const source = await res.json();
console.log(JSON.stringify({ phase: 'resolve', target, status: res.status, seconds: (Date.now() - started) / 1000, provider: source.provider, message: source.message, translations: source.translations?.length }));
assert.equal(res.status, 200, source.message);
assert.equal(source.provider, 'torrent');
assert.ok(source.streamUrl.startsWith('https://video.93-123-84-128.sslip.io/'));
assert.ok(!JSON.stringify(source).includes('X-Kihema-Key'));

async function playlist(url, depth = 0) {
	assert.ok(depth < 4, 'playlist recursion');
	const response = await fetch(url, { headers: { Origin: base }, signal: AbortSignal.timeout(30_000) });
	const text = await response.text();
	console.log(JSON.stringify({ phase: 'playlist', status: response.status, cors: response.headers.get('access-control-allow-origin'), depth }));
	assert.equal(response.status, 200, text.slice(0, 120));
	assert.equal(response.headers.get('access-control-allow-origin'), 'https://kihema.vercel.app');
	assert.ok(text.trimStart().startsWith('#EXTM3U'));
	const lines = text.split(/\r?\n/).map((s) => s.trim());
	const first = lines.find((line) => line && !line.startsWith('#'));
	assert.ok(first, 'playlist is empty');
	if (text.includes('#EXT-X-STREAM-INF')) return playlist(new URL(first, response.url), depth + 1);
	const init = text.match(/#EXT-X-MAP:.*URI="([^"]+)"/)?.[1];
	for (const uri of [init, first].filter(Boolean)) {
		const segment = await fetch(new URL(uri, response.url), { headers: { Origin: base }, signal: AbortSignal.timeout(30_000) });
		assert.equal(segment.status, 200);
		const reader = segment.body.getReader();
		let bytes = 0;
		while (bytes < 64 * 1024) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.length;
		}
		await reader.cancel();
		console.log(JSON.stringify({ phase: init === uri ? 'init' : 'segment', status: segment.status, bytes, contentType: segment.headers.get('content-type') }));
		assert.ok(bytes > 0);
	}
}

await playlist(source.streamUrl);
console.log(JSON.stringify({ passed: true, seconds: (Date.now() - started) / 1000 }));
