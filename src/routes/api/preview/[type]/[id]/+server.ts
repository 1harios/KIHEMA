/**
 * Подробности тайтла для всплывающей панели карточки.
 *
 * Отдаёт ровно три вещи, которых нет в списочных ответах TMDB: названия жанров,
 * возрастной рейтинг и длительность. Плюс описание и рейтинг — на случай, когда
 * карточка пришла из источника, где их не было.
 *
 * Запрос делается по наведению, поэтому важны две вещи. Первая — кэш: сутки на
 * CDN и в браузере, у вышедшего тайтла эти поля не меняются. Вторая — дешевизна
 * самого запроса: см. tmdb.preview, там один append вместо одиннадцати.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTitlePreview } from '$lib/server/catalog';
import type { MediaType } from '$lib/types';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
	const type = params.type === 'movie' ? 'movie' : params.type === 'show' ? 'show' : null;
	if (!type) error(400, 'Тип должен быть movie или show');

	const tmdbId = Number.parseInt(params.id, 10);
	if (!Number.isFinite(tmdbId) || tmdbId <= 0) error(400, 'Некорректный идентификатор');

	const preview = await getTitlePreview(type as MediaType, tmdbId);
	if (!preview) error(404, 'Тайтл не найден');

	setHeaders({ 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' });
	return json(preview);
};
