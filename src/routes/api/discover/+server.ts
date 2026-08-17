import { json, type RequestHandler } from '@sveltejs/kit';
import { discoverBatch } from '$lib/server/catalog';
import { parseFilters } from '$lib/server/catalog-loader';
import type { MediaType } from '$lib/types';

/**
 * Догрузка следующей страницы каталога.
 *
 * Нужна ради кнопки «Показать ещё»: полная навигация по ?page= перерисовывает
 * страницу и отправляет пользователя наверх, теряя место, до которого он
 * доскроллил. Ссылочная пагинация при этом остаётся в разметке как фолбэк без JS
 * и как то, что можно переслать.
 *
 * Фильтры разбираются тем же parseFilters, что и у страницы: две разные функции
 * разбора неизбежно расходятся.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const rawType = url.searchParams.get('type');
	const type: MediaType = rawType === 'show' ? 'show' : 'movie';

	const filters = parseFilters(type, url);
	// Догружаем по две страницы: сорок карточек за одно нажатие ощущаются как
	// продолжение списка, двадцать — как «опять мало».
	const result = await discoverBatch(type, filters, 2);

	// Тот же кеш, что у страницы каталога: выдача Discover меняется медленно.
	setHeaders({ 'cache-control': 'public, max-age=300' });

	return json({
		items: result.items,
		totalPages: result.totalPages,
		totalResults: result.totalResults,
		nextPage: result.nextPage
	});
};
