import { error } from '@sveltejs/kit';
import { getPerson } from '$lib/server/catalog';
import { parseTmdbSlug } from '$lib/slug';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const tmdbId = parseTmdbSlug(params.slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	const person = await getPerson(tmdbId);
	if (!person) error(404, 'Персона не найдена');

	// Фильмография пополняется несколько раз в год, а страница тяжёлая
	// (combined_credits + images одним запросом) — час кеша на CDN оправдан.
	setHeaders({ 'cache-control': 'public, max-age=3600' });

	return { person };
};
