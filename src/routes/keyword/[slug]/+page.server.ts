import { error } from '@sveltejs/kit';
import { discover, getKeyword } from '$lib/server/catalog';
import { parseTmdbSlug } from '$lib/slug';
import type { PageServerLoad } from './$types';

/** TMDB отдаёт максимум 500 страниц; на 501-й он отвечает ошибкой, а не пустотой. */
const MAX_PAGE = 500;

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const tmdbId = parseTmdbSlug(params.slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	const requested = Number.parseInt(url.searchParams.get('page') ?? '', 10);
	const currentPage = Number.isFinite(requested)
		? Math.min(Math.max(requested, 1), MAX_PAGE)
		: 1;

	// Название и выдачу запрашиваем параллельно: они не зависят друг от друга,
	// а последовательно это два похода в TMDB подряд.
	const [keyword, result] = await Promise.all([
		getKeyword(tmdbId),
		discover('movie', { keywords: [tmdbId], sortBy: 'popularity.desc', page: currentPage })
	]);

	if (!keyword) error(404, 'Ключевое слово не найдено');

	setHeaders({ 'cache-control': 'public, max-age=3600' });

	return {
		keyword,
		currentPage,
		items: result.items,
		totalPages: Math.min(result.totalPages, MAX_PAGE),
		totalResults: result.totalResults
	};
};
