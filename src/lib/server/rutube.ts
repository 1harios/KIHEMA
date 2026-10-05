import { RUTUBE_ID } from '$lib/rutube';

export interface RutubeMetadata { id: string; title: string; duration: number; poster: string | null }
const cache = new Map<string, { at: number; value: RutubeMetadata }>();
export async function rutubeMetadata(id: string): Promise<RutubeMetadata> {
	if (!RUTUBE_ID.test(id)) throw new Error('Invalid RUTUBE id');
	const cached = cache.get(id);
	if (cached && Date.now() - cached.at < 15 * 60_000) return cached.value;
	const fallback: RutubeMetadata = { id, title: 'Видео RUTUBE', duration: 0, poster: null };
	try {
		// Fixed host + validated ID prevents user-supplied URLs becoming SSRF.
		const response = await fetch(`https://rutube.ru/api/video/${id}/?format=json`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
		if (!response.ok) return fallback;
		const data = await response.json();
		let poster: string | null = null;
		try {
			const url = new URL(data.thumbnail_url);
			if (url.protocol === 'https:' && /(^|\.)(rutube\.ru|rtbcdn\.ru)$/.test(url.hostname)) poster = url.href;
		} catch { /* thumbnail is optional */ }
		const value = { ...fallback, title: typeof data.title === 'string' ? data.title.slice(0, 250) : fallback.title,
			duration: typeof data.duration === 'number' && data.duration > 0 && data.duration <= 604_800 ? data.duration : 0, poster };
		if (cache.size >= 100) cache.delete(cache.keys().next().value!);
		cache.set(id, { at: Date.now(), value });
		return value;
	} catch { return fallback; }
}
