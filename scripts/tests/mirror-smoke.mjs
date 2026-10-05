import assert from 'node:assert/strict';

const mirror = 'https://kihema.93-123-84-128.sslip.io';
const primary = 'https://kihema.vercel.app';
const media = 'https://video.93-123-84-128.sslip.io';
async function request(url, options = {}) {
	return fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
}
for (const base of [mirror, primary]) {
	const response = await request(base);
	assert.equal(response.status, 200);
	const html = await response.text();
	assert.ok(html.includes('КИНЕМА — фильмы и сериалы онлайн'));
	console.log(JSON.stringify({ phase: 'website', base, bytes: html.length }));
}
const redirect = await request(mirror.replace('https:', 'http:'), { redirect: 'manual' });
assert.equal(redirect.status, 308);
assert.equal(new URL(redirect.headers.get('location')).origin, mirror);
const party = await request(`${mirror}/api/party/url`);
assert.equal(party.status, 200);
assert.equal((await party.json()).url, `${mirror}/party`);
const search = await request(`${mirror}/api/search?q=${encodeURIComponent('Бойцовский клуб')}&compact=1`);
assert.equal(search.status, 200);
const titles = (await search.json()).titles;
const title = titles.find((item) => item.tmdbId === 550);
assert.ok(title, 'live Russian catalog search');
assert.ok(title.poster.startsWith('/api/img?'));
const poster = await request(new URL(title.poster, mirror));
assert.equal(poster.status, 200);
assert.ok(poster.headers.get('content-type')?.startsWith('image/'));
assert.ok((await poster.arrayBuffer()).byteLength > 1000);
console.log(JSON.stringify({ phase: 'search-and-poster', count: titles.length }));
const corsPath = `${media}/gst/${'a'.repeat(40)}/master.m3u8`;
for (const origin of [primary, mirror, 'https://evil.test', `${mirror}.evil.test`]) {
	for (const method of ['OPTIONS', 'GET']) {
		const response = await request(corsPath, { method, headers: { Origin: origin } });
		const allow = response.headers.get('access-control-allow-origin');
		if (origin === primary || origin === mirror) assert.equal(allow, origin);
		else assert.ok(!allow, 'foreign sites must not get media CORS');
		assert.ok(response.headers.get('vary')?.includes('Origin'));
		await response.body?.cancel();
	}
}
for (const path of ['/torrents', '/settings', '/gst/settings']) {
	const response = await request(`${media}${path}`);
	assert.equal(response.status, 404, `private management route ${path}`);
	await response.body?.cancel();
}
console.log(JSON.stringify({ passed: true, phases: ['https', 'website', 'party-url', 'search', 'poster', 'cors-allowlist', 'private-api'] }));
