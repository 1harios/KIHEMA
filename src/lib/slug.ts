/** Разбирает `652-troya` в TMDB ID. Хвост нужен только для читаемости URL и SEO. */
export function parseTmdbSlug(slug: string): number | null {
	const id = Number.parseInt(slug.split('-')[0], 10);
	return Number.isFinite(id) && id > 0 ? id : null;
}

export function toSlug(tmdbId: number, title: string): string {
	const tail = title
		.toLowerCase()
		.replace(/[ё]/g, 'e')
		.replace(/[^a-zа-я0-9]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return tail ? `${tmdbId}-${tail}` : String(tmdbId);
}
