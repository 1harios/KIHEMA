import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getTitleBrief } from '$lib/server/catalog';
import { parseTmdbSlug, toMediaSlug } from '$lib/slug';

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const tmdbId = parseTmdbSlug(params.slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	// Краткий запрос вместо полных деталей: странице нужны название и кадр, а
	// не титры с отзывами. Разница — сотни килобайт до первого байта.
	const title = await getTitleBrief('movie', tmdbId);
	if (!title) error(404, 'Тайтл не найден');
	const canonicalSlug = toMediaSlug(title);
	if (params.slug !== canonicalSlug) {
		redirect(308, `/movie/${canonicalSlug}/watch${url.search}`);
	}
	if (!title.inLibrary) error(404, 'Фильма нет в медиатеке');

	setHeaders({ 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' });

	return {
		target: { type: 'movie' as const, tmdbId },
		context: {
			title: title.title,
			originalTitle: title.originalTitle,
			type: 'movie' as const,
			tmdbId
		},
		// Кадр и постер — для экрана ожидания в плеере.
		art: { backdrop: title.backdrop, poster: title.poster },
		backHref: `/movie/${canonicalSlug}`
	};
};
