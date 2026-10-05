/** Closed sticker/reaction catalog; never accept arbitrary sticker image URLs. */
export const PARTY_REACTIONS = ['❤️', '😂', '👍', '😮', '🔥', '👏', '😍', '😭', '🤣', '😱', '🤔', '😎', '🥳', '🙈', '💔', '👎', '🤯', '😴', '🍿', '🫶', '😘', '🤩', '🤡', '💯'] as const;
export const PARTY_STICKERS = [
	{ id: 'drink', label: 'Лимонад', src: '/stickers/drink.png' },
	{ id: 'snack', label: 'Перекус', src: '/stickers/snack.png' },
	{ id: 'kiss', label: 'Поцелуй', src: '/stickers/kiss.png' },
	{ id: 'chopsticks', label: 'Вкусно', src: '/stickers/chopsticks.png' },
	{ id: 'smile', label: 'Улыбка', src: '/stickers/smile.png' }
] as const;
export const stickerById = (id: unknown) => PARTY_STICKERS.find((sticker) => sticker.id === id);

export interface PartyGif { url: string; title: string; source: string; author: string; license: string; }

/** Search and chat share this fixed host/path allowlist. No proxy/SSRF URLs. */
export function partyGif(value: unknown): PartyGif | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.url !== 'string' || raw.url.length > 1200) return null;
	try {
		const url = new URL(raw.url);
		if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.port || url.username || url.password || url.search || url.hash || !/^\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\.gif$/i.test(url.pathname)) return null;
		const filename = decodeURIComponent(url.pathname.split('/').at(-1)!);
		if (/[\x00-\x1f]/.test(filename)) return null;
		const text = (field: unknown, max: number) => typeof field === 'string' ? field.replace(/[\x00-\x1f]/g, '').trim().slice(0, max) : '';
		return { url: url.href, title: text(raw.title, 180) || filename.replace(/_/g, ' '), source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`, author: text(raw.author, 200), license: text(raw.license, 80) };
	} catch { return null; }
}
