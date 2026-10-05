import { partyGif, type PartyGif } from '$lib/party-media';

const synonyms: Record<string, string> = { 'кот': 'cat', 'коты': 'cat', 'котики': 'cat', 'кошка': 'cat', 'собака': 'dog', 'собаки': 'dog', 'смех': 'laugh', 'танцы': 'dance', 'танец': 'dance', 'объятия': 'hug', 'любовь': 'love', 'поцелуй': 'kiss', 'привет': 'hello' };
const cache = new Map<string, { until: number; results: PartyGif[] }>();
const pending = new Map<string, Promise<PartyGif[]>>();
const plain = (value: unknown) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim() : '';

/** Official public MediaWiki API; no borrowed keys or undocumented scraping. */
export async function searchPartyGifs(query: string, fetcher: typeof fetch = fetch): Promise<PartyGif[]> {
	const words = query.trim().replace(/[\x00-\x1f]/g, '').slice(0, 80) || 'cat';
	const term = synonyms[words.toLowerCase()] || words;
	const cached = cache.get(term);
	if (cached && cached.until > Date.now()) return cached.results;
	const existing = pending.get(term);
	if (existing) return existing;
	const request = (async () => {
		const url = new URL('https://commons.wikimedia.org/w/api.php');
		url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${term} filemime:image/gif`, gsrnamespace: '6', gsrlimit: '18', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata' }).toString();
		const res = await fetcher(url, { signal: AbortSignal.timeout(9000), redirect: 'error', headers: { 'User-Agent': 'KIHEMA/0.1 (https://github.com/1harios/KIHEMA; watch-party GIF search)' } });
		if (!res.ok) throw new Error('GIF provider unavailable');
		const data = await res.json();
		if (data.error) throw new Error('GIF provider rejected search');
		const results = (Array.isArray(data.query?.pages) ? data.query.pages : []).sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0)).map((page: { title: string; imageinfo?: Record<string, any>[] }) => {
			const info = page.imageinfo?.[0];
			if (!info || info.mime !== 'image/gif' || typeof info.size !== 'number' || info.size > 8_388_608 || !info.extmetadata?.LicenseShortName?.value) return null;
			const media = new URL(info.url); media.search = ''; media.hash = '';
			return partyGif({ url: media.href, title: page.title.replace(/^File:/, ''), author: plain(info.extmetadata.Artist?.value), license: plain(info.extmetadata.LicenseShortName?.value) });
		}).filter((item: PartyGif | null): item is PartyGif => item !== null).slice(0, 12);
		if (cache.size >= 100) cache.delete(cache.keys().next().value!);
		cache.set(term, { until: Date.now() + 600_000, results });
		return results;
	})();
	pending.set(term, request);
	try { return await request; } finally { pending.delete(term); }
}
