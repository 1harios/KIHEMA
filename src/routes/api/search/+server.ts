import { json, type RequestHandler } from '@sveltejs/kit';
import { searchCatalog, searchPeople } from '$lib/server/catalog';

/**
 * Поиск для живых подсказок и для догрузки на странице поиска.
 *
 * Тайтлы и люди — независимые запросы к TMDB, поэтому идут параллельно:
 * последовательно это удвоило бы задержку ради ровно нулевой выгоды.
 *
 * Отмена устаревших запросов делается на клиенте (AbortController) — на сервере
 * отменять нечего, здесь важно только не делать работу впустую при пустом вводе.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);

	// Односимвольный запрос даёт бессмысленную выдачу и жжёт лимит зря.
	if (q.length < 2) {
		return json({ titles: [], people: [], totalPages: 0, totalResults: 0 });
	}

	/** Подсказкам нужно немного; странице — всё, что отдала TMDB. */
	const compact = url.searchParams.get('compact') === '1';

	const [titles, people] = await Promise.all([
		searchCatalog(q, page),
		// Персоны только на первой странице: во второй они уже не нужны.
		page === 1 ? searchPeople(q, compact ? 4 : 12) : Promise.resolve([])
	]);

	const items = compact ? titles.items.slice(0, 8) : titles.items;

	// Выдача поиска меняется медленно, но не настолько, чтобы держать её сутки.
	setHeaders({ 'cache-control': 'public, max-age=300' });

	return json({
		titles: items,
		people,
		totalPages: titles.totalPages,
		totalResults: titles.totalResults
	});
};
