import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
function load(file, require = () => {}) {
	const exports = {};
	const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
	new Function('exports', 'require', outputText)(exports, require);
	return exports;
}
const media = load('src/lib/party-media.ts');
const url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat_funny.gif';
test('closed catalog has 24 unique reactions and five PNG stickers', () => {
	assert.equal(new Set(media.PARTY_REACTIONS).size, 24);
	assert.equal(media.PARTY_STICKERS.length, 5);
	for (const sticker of media.PARTY_STICKERS) {
		assert.equal(media.stickerById(sticker.id), sticker);
		assert.ok(readFileSync(`static${sticker.src}`).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
	}
	assert.equal(media.stickerById('../other'), undefined);
});
test('GIF source is canonical and metadata length is bounded', () => {
	const gif = media.partyGif({ url, source: 'javascript:bad', title: 'a'.repeat(500), author: 'author\n', license: 'CC BY-SA' });
	assert.equal(gif.source, 'https://commons.wikimedia.org/wiki/File:Cat_funny.gif');
	assert.equal(gif.title.length, 180);
	assert.equal(gif.author, 'author');
});
test('GIF validation rejects foreign URLs, credentials, ports, queries, invalid paths', () => {
	for (const bad of ['https://evil.test/a.gif', url.replace('https:', 'http:'), url.replace('upload.', 'user@upload.'), url.replace('.org/', '.org:444/'), url + '?bad=1', url + '#hash', url.replace('Cat_funny.gif', '%00.gif'), url.replace('.gif', '.svg')]) assert.equal(media.partyGif({ url: bad }), null, bad);
	assert.equal(media.partyGif(null), null);
});
test('official search normalizes Russian queries, validates results, strips HTML and caches', async () => {
	const search = load('src/lib/server/party-gifs.ts', (id) => { assert.equal(id, '$lib/party-media'); return media; });
	let calls = 0;
	const fetcher = async (request) => {
		calls++;
		assert.equal(request.hostname, 'commons.wikimedia.org');
		assert.equal(request.searchParams.get('gsrsearch'), 'cat filemime:image/gif');
		const valid = { url: url + '?utm=tracking', mime: 'image/gif', size: 1000, extmetadata: { Artist: { value: '<b>Artist</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } };
		return new Response(JSON.stringify({ query: { pages: [{ title: 'File:Cat_funny.gif', index: 1, imageinfo: [valid] }, { title: 'File:Too_big.gif', index: 2, imageinfo: [{ ...valid, size: 10_000_000 }] }, { title: 'File:No_license.gif', imageinfo: [{ ...valid, extmetadata: {} }] }] } }));
	};
	const result = await search.searchPartyGifs('Коты', fetcher);
	assert.equal(result.length, 1); assert.equal(result[0].author, 'Artist'); assert.equal(result[0].url, url);
	await search.searchPartyGifs('Коты', fetcher); assert.equal(calls, 1);
});
test('search failures are propagated, not mistaken for no results', async () => {
	const { searchPartyGifs } = load('src/lib/server/party-gifs.ts', () => media);
	await assert.rejects(searchPartyGifs('failure', async () => new Response('', { status: 503 })), /unavailable/);
});
