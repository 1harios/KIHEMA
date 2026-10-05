import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, fetch = globalThis.fetch) {
	const exports = {};
	const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	});
	new Function('exports', '$state', 'fetch', outputText)(exports, (value) => value, fetch);
	return exports;
}
const helpers = load('src/lib/party-sync.ts');

test('fullscreen request includes the room and falls back when the API rejects', async () => {
	const { enterFullscreen } = load('src/lib/player/fullscreen.ts');
	const root = { requestFullscreen: async () => { throw new Error('unsupported on this phone'); } };
	assert.equal(await enterFullscreen(root), false);
	assert.equal(await enterFullscreen({}), false);
});

test('fullscreen uses the entire root and exits the matching WebKit API', async () => {
	const { enterFullscreen, exitFullscreen } = load('src/lib/player/fullscreen.ts');
	let exited = false;
	const previous = globalThis.document;
	try {
		globalThis.document = { fullscreenElement: null, webkitFullscreenElement: null,
			exitFullscreen: () => { throw new Error('wrong fullscreen API'); },
			webkitExitFullscreen: () => { exited = true; } };
		const root = { webkitRequestFullscreen: () => { document.webkitFullscreenElement = root; } };
		assert.equal(await enterFullscreen(root), true);
		await exitFullscreen();
		assert.equal(exited, true);
	} finally { if (previous) globalThis.document = previous; else delete globalThis.document; }
});

test('subtitles off disables native captions and the HLS subtitle engine', () => {
	const { PlayerController } = load('src/lib/player/controller.svelte.ts');
	const player = new PlayerController();
	const subtitles = { kind: 'subtitles', mode: 'showing' };
	const captions = { kind: 'captions', mode: 'showing' };
	const metadata = { kind: 'metadata', mode: 'hidden' };
	player.video = { textTracks: [subtitles, captions, metadata], querySelectorAll: () => [] };
	player.hls = { subtitleTrack: 0, subtitleDisplay: true };
	player.selectSubtitle(null);
	assert.equal(player.hls.subtitleTrack, -1);
	assert.equal(player.hls.subtitleDisplay, false);
	assert.equal(subtitles.mode, 'disabled');
	assert.equal(captions.mode, 'disabled');
	assert.equal(metadata.mode, 'hidden');
});

test('native subtitle selection enables only the chosen track', () => {
	const { PlayerController } = load('src/lib/player/controller.svelte.ts');
	const player = new PlayerController();
	const tracks = [{ kind: 'subtitles', mode: 'disabled' }, { kind: 'subtitles', mode: 'showing' }];
	player.video = { textTracks: tracks, querySelectorAll: () => [] };
	player.embeddedSubtitles = [{ id: 'native:0', engine: 'native', index: 0, label: 'Русские' }];
	player.selectSubtitle('native:0');
	assert.equal(tracks[0].mode, 'showing');
	assert.equal(tracks[1].mode, 'disabled');
});

test('join accepts a room code, a new invite, or a legacy player URL', () => {
	assert.equal(helpers.roomCodeFrom(' abc234 '), 'ABC234');
	assert.equal(helpers.roomCodeFrom('https://kihema.vercel.app/party/ABC234'), 'ABC234');
	assert.equal(helpers.roomCodeFrom('https://kihema.vercel.app/movie/550-film/watch?room=abc234&t=45'), 'ABC234');
	assert.equal(helpers.roomCodeFrom('wrong'), null);
});

test('room navigation keeps episode but drops personal progress and foreign URLs', () => {
	assert.equal(helpers.watchHref('/show/1-test/watch?season=2&episode=3&t=500&room=ABC234'), '/show/1-test/watch?episode=3&season=2');
	assert.equal(helpers.watchHref('//example.com/movie/1/watch'), null);
	assert.equal(helpers.watchHref('https://example.com/movie/1/watch'), null);
});

test('scheduled start never produces a negative seek and respects shared rate', () => {
	const state = { paused: false, positionSec: 20, anchorTs: 5000, rate: 1.5 };
	assert.equal(helpers.roomPosition(state, 2000), 20);
	assert.equal(helpers.roomPosition(state, 7000), 23);
	assert.equal(helpers.roomPosition({ ...state, buffering: true }, 7000), 20);
});

test('small drift is corrected smoothly', () => {
	assert.equal(helpers.syncRate(1, 0.1), 1);
	assert.ok(helpers.syncRate(1, 0.8) > 1);
	assert.ok(helpers.syncRate(1, -0.8) < 1);
});

test('only explicit player controls emit room commands', async () => {
	const { PlayerController } = load('src/lib/player/controller.svelte.ts');
	const player = new PlayerController();
	player.video = { currentTime: 10, paused: true, play: async () => {}, pause: () => {} };
	const intents = [];
	player.onIntent = (intent) => intents.push(intent);
	await player.play();
	player.pause();
	player.seek(15, false);
	player.setRate(1, false);
	assert.equal(intents.length, 0);
	player.togglePlay();
	player.seek(30);
	player.setRate(1.5);
	assert.deepEqual(intents.map((i) => i.type), ['state', 'seek', 'rate']);
});

test('a late resolver response cannot replace the next film', async () => {
	const pending = [];
	const { PlayerController } = load('src/lib/player/controller.svelte.ts', async (url) => {
		if (url === '/api/playback/resolve') return new Promise((resolve) => pending.push(resolve));
		return new Response(null, { status: 204 });
	});
	const player = new PlayerController();
	player.allowAutoplay = () => false;
	player.attach = async () => {};
	const source = (id) => ({ provider: 'archive', jellyfinItemId: id, streamUrl: 'https://example.invalid/video.mp4', translations: [], subtitles: [], segments: [] });
	const first = player.load({ type: 'movie', tmdbId: 1 });
	player.destroy();
	const second = player.load({ type: 'movie', tmdbId: 2 });
	pending[1](Response.json(source('second')));
	await second;
	pending[0](Response.json(source('first')));
	await first;
	assert.equal(player.source.jellyfinItemId, 'second');
	player.destroy();
});
