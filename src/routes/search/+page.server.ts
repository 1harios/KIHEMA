import type { PageServerLoad } from './$types';
import { searchCatalog, searchPeople } from '$lib/server/catalog';

/**
 * Первая страница выдачи поиска.
 *
 * Дальше страница догружает сама через /api/search — так прокрутка не сбрасывается
 * наверх. Разделить типы (фильм/сериал) на сервере нельзя: TMDB отдаёт их одним
 * multi-запросом без фильтра по типу, поэтому вкладки на клиенте делят уже
 * полученное.
 */
export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const q = (url.searchParams.get('q') ?? '').trim();

	// Односимвольный запрос даёт бессмысленную выдачу и жжёт лимит зря.
	if (q.length < 2) {
		return { q, titles: [], people: [], totalPages: 0, totalResults: 0 };
	}

	// Тайтлы и люди — независимые запросы. Последовательно это удвоило бы время
	// до первой отрисовки ради ровно нулевой выгоды.
	const [titles, people] = await Promise.all([searchCatalog(q), searchPeople(q)]);

	setHeaders({ 'cache-control': 'public, max-age=300' });

	return {
		q,
		titles: titles.items,
		people,
		totalPages: titles.totalPages,
		totalResults: titles.totalResults
	};
};
