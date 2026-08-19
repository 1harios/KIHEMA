/** Разбирает `652-troya` в TMDB ID. Хвост нужен только для читаемости URL и SEO. */
export function parseTmdbSlug(slug: string): number | null {
	const id = Number.parseInt(slug.split('-')[0], 10);
	return Number.isFinite(id) && id > 0 ? id : null;
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	д: 'd',
	е: 'e',
	ё: 'e',
	ж: 'zh',
	з: 'z',
	и: 'i',
	й: 'y',
	к: 'k',
	л: 'l',
	м: 'm',
	н: 'n',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	у: 'u',
	ф: 'f',
	х: 'kh',
	ц: 'ts',
	ч: 'ch',
	ш: 'sh',
	щ: 'shch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya',
	і: 'i',
	ї: 'yi',
	є: 'ye',
	ґ: 'g'
};

function latinize(value: string): string {
	return value
		.toLowerCase()
		.split('')
		.map((char) => CYRILLIC_TO_LATIN[char] ?? char)
		.join('')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '');
}

export function toSlug(tmdbId: number, title: string): string {
	const tail = latinize(title)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return tail ? `${tmdbId}-${tail}` : String(tmdbId);
}

/** Для медиа предпочитаем оригинальное латинское название из TMDB. */
export function toMediaSlug(item: {
	tmdbId: number;
	title: string;
	originalTitle?: string;
}): string {
	const source = item.originalTitle && /[a-z]/i.test(item.originalTitle)
		? item.originalTitle
		: item.title;
	return toSlug(item.tmdbId, source);
}
