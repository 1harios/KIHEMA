import { error } from '@sveltejs/kit';
import { getCollection } from '$lib/server/catalog';
import { parseTmdbSlug } from '$lib/slug';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const tmdbId = parseTmdbSlug(params.slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	const collection = await getCollection(tmdbId);
	if (!collection) error(404, 'Франшиза не найдена');

	// Состав франшизы меняется раз в несколько лет, отметка «есть в медиатеке»
	// приезжает из индекса при рендере. Шесть часов кеша ничего не ломают.
	setHeaders({ 'cache-control': 'public, max-age=21600' });

	return { collection };
};
