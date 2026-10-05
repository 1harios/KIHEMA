/** Official iframe API only: no media URLs, DRM tokens or stream extraction. */
export const RUTUBE_ORIGIN = 'https://rutube.ru';
export const RUTUBE_ID = /^[a-f0-9]{32}$/;

export function rutubeIdFrom(input: string): string | null {
	try {
		const url = new URL(input.trim());
		if (url.protocol !== 'https:' || !['rutube.ru', 'www.rutube.ru'].includes(url.hostname) || url.username || url.password || url.port) return null;
		const id = url.pathname.match(/^\/(?:video|shorts|play\/embed)\/([a-f0-9]{32})\/?$/i)?.[1]?.toLowerCase();
		return id && RUTUBE_ID.test(id) ? id : null;
	} catch { return null; }
}

export const rutubeWatchHref = (id: string) => `/rutube/${id}/watch`;
export const rutubeVideoUrl = (id: string) => `${RUTUBE_ORIGIN}/video/${id}/`;
export function rutubeEmbedUrl(id: string): string {
	if (!RUTUBE_ID.test(id)) throw new Error('Invalid RUTUBE id');
	return `${RUTUBE_ORIGIN}/play/embed/${id}/?getPlayOptions=title,thumbnail_url&skinColor=dce2eb`;
}

export function readRutubeMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frame: Window | null): { type: string; data: Record<string, unknown> } | null {
	if (!frame || event.source !== frame || event.origin !== RUTUBE_ORIGIN) return null;
	try {
		if (typeof event.data === 'string' && event.data.length > 16_384) return null;
		const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
		if (!message || typeof message !== 'object' || typeof message.type !== 'string' || !message.type.startsWith('player:')) return null;
		return { type: message.type, data: message.data && typeof message.data === 'object' ? message.data : {} };
	} catch { return null; }
}

export function rutubeNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 604_800 ? value : null;
}
