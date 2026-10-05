import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
function load(file) {
	const exports = {};
	const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
	new Function('exports', outputText)(exports);
	return exports;
}
const api = load('src/lib/rutube.ts');
const { watchHref } = load('src/lib/party-sync.ts');
const id = '564f31c881b83373bfe0cb26979d44cf';
test('normal video, shorts and embed links normalize to the same safe ID', () => {
	for (const path of ['video', 'shorts', 'play/embed']) assert.equal(api.rutubeIdFrom(`https://rutube.ru/${path}/${id}/?utm=test`), id);
	assert.equal(api.rutubeIdFrom(`https://www.rutube.ru/video/${id.toUpperCase()}`), id);
});
test('foreign hosts, credentials, script schemes and malformed IDs are rejected', () => {
	for (const input of [`http://rutube.ru/video/${id}`, `https://rutube.ru.evil.test/video/${id}`, `https://evil.test/video/${id}`, `https://user@rutube.ru/video/${id}`, `https://rutube.ru:444/video/${id}`, `https://rutube.ru/video/${id}/other`, 'javascript:alert(1)']) assert.equal(api.rutubeIdFrom(input), null);
});
test('embed always uses the official fixed host and validated ID', () => {
	assert.equal(new URL(api.rutubeEmbedUrl(id)).origin, 'https://rutube.ru');
	assert.throws(() => api.rutubeEmbedUrl('../evil'));
});
test('postMessages require BOTH the exact origin and the correct frame window', () => {
	const frame = {};
	const data = JSON.stringify({ type: 'player:currentTime', data: { time: 12 } });
	assert.equal(api.readRutubeMessage({ origin: 'https://rutube.ru', source: frame, data }, frame).data.time, 12);
	for (const event of [{ origin: 'https://evil.test', source: frame, data }, { origin: 'https://rutube.ru', source: {}, data }, { origin: 'https://rutube.ru', source: frame, data: '{bad' }]) assert.equal(api.readRutubeMessage(event, frame), null);
	assert.equal(api.readRutubeMessage({ origin: 'https://rutube.ru', source: null, data }, null), null);
});
test('invalid media times cannot enter the room clock', () => {
	for (const time of [NaN, Infinity, -1, true, '12', 604801]) assert.equal(api.rutubeNumber(time), null);
	assert.equal(api.rutubeNumber(12.5), 12.5);
});
test('RUTUBE room targets are internal, strict, and omit personal/query tokens', () => {
	assert.equal(watchHref(`/rutube/${id}/watch?room=ABCDEF&t=20&private=secret`), `/rutube/${id}/watch`);
	for (const target of [`/rutube/invalid/watch`, `https://rutube.ru/video/${id}`, `//evil.test/rutube/${id}/watch`]) assert.equal(watchHref(target), null);
});
