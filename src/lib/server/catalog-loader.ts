/**
 * Разбор фильтров каталога из URL.
 *
 * Всё состояние фильтров живёт в query-строке, а не в компоненте. Это не вопрос
 * вкуса: подборку «корейские триллеры 2010-х с рейтингом от 7.5» нужно уметь
 * переслать ссылкой, открыть в новой вкладке и вернуть кнопкой «назад». Состояние
 * внутри Svelte-компонента ни одного из этих трёх свойств не даёт.
 *
 * Формат намеренно короткий: g=28,53 вместо genres[]=28&genres[]=53 — ссылка с
 * шестью фильтрами остаётся читаемой.
 */

import { discoverBatch, getGenres, getProviders } from './catalog';
import { COUNTRIES, SHOW_STATUS, SORT_OPTIONS, SORT_OPTIONS_TV } from './tmdb';
import type { DiscoverFilters, MediaType } from '$lib/types';

const num = (v: string | null): number | undefined => {
	const n = Number.parseInt(v ?? '', 10);
	return Number.isFinite(n) ? n : undefined;
};

const float = (v: string | null): number | undefined => {
	const n = Number.parseFloat(v ?? '');
	return Number.isFinite(n) ? n : undefined;
};

/** «28,53» -> [28, 53]. Пустые и нечисловые значения отбрасываем молча. */
const nums = (v: string | null): number[] | undefined => {
	if (!v) return undefined;
	const list = v
		.split(',')
		.map((x) => Number.parseInt(x, 10))
		.filter((n) => Number.isFinite(n));
	return list.length ? list : undefined;
};

const strs = (v: string | null): string[] | undefined => {
	if (!v) return undefined;
	const list = v.split(',').filter(Boolean);
	return list.length ? list : undefined;
};

const CURRENT_YEAR = new Date().getFullYear();

/** Границы года: защита от ?from=99999 и от перевёрнутого диапазона. */
function yearRange(from?: number, to?: number) {
	const lo = from && from >= 1874 && from <= CURRENT_YEAR + 5 ? from : undefined;
	const hi = to && to >= 1874 && to <= CURRENT_YEAR + 5 ? to : undefined;
	if (lo && hi && lo > hi) return { yearFrom: hi, yearTo: lo };
	return { yearFrom: lo, yearTo: hi };
}

export function parseFilters(type: MediaType, url: URL): DiscoverFilters {
	const p = url.searchParams;
	const allowed = (type === 'movie' ? SORT_OPTIONS : SORT_OPTIONS_TV).map(
		(o) => o.value as string
	);
	const sort = p.get('sort');

	const { yearFrom, yearTo } = yearRange(num(p.get('from')), num(p.get('to')));

	return {
		genres: nums(p.get('g')),
		excludeGenres: nums(p.get('xg')),
		genresMatchAll: p.get('all') === '1',
		keywords: nums(p.get('kw')),
		yearFrom,
		yearTo,
		runtimeFrom: num(p.get('rtf')),
		runtimeTo: num(p.get('rtt')),
		minRating: float(p.get('rating')),
		minVotes: num(p.get('votes')),
		country: p.get('country') ?? undefined,
		language: p.get('lang') ?? undefined,
		providers: nums(p.get('prov')),
		monetization: strs(p.get('mon')),
		networks: nums(p.get('net')),
		showStatus: nums(p.get('status')),
		// Неизвестный ключ сортировки TMDB отвергает целым запросом, поэтому
		// сверяем со списком, а не передаём как есть.
		sortBy: sort && allowed.includes(sort) ? sort : 'popularity.desc',
		page: num(p.get('page')) ?? 1,
		onlyLibrary: p.get('lib') === '1'
	};
}

/** Сколько фильтров реально применено — для счётчика на кнопке «Фильтры». */
export function countActive(f: DiscoverFilters): number {
	let n = 0;
	if (f.genres?.length) n++;
	if (f.excludeGenres?.length) n++;
	if (f.keywords?.length) n++;
	if (f.yearFrom || f.yearTo) n++;
	if (f.runtimeFrom || f.runtimeTo) n++;
	if (f.minRating) n++;
	if (f.minVotes) n++;
	if (f.country) n++;
	if (f.language) n++;
	if (f.providers?.length) n++;
	if (f.monetization?.length) n++;
	if (f.networks?.length) n++;
	if (f.showStatus?.length) n++;
	// onlyLibrary в счётчике больше нет: фильтр убран из интерфейса, а параметр
	// продолжаем принимать только ради старых ссылок.
	return n;
}

export async function loadCatalog(
	type: MediaType,
	url: URL,
	setHeaders?: (headers: Record<string, string>) => void
) {
	const filters = parseFilters(type, url);

	// Жанры и провайдеры кешируются на сутки в клиенте TMDB, так что это дёшево.
	// Каталог тянем сразу тремя страницами: 20 карточек на широком экране — это
	// три ряда, и список выглядит пустым.
	const [result, genres, providers] = await Promise.all([
		discoverBatch(type, filters, 3),
		getGenres(type),
		getProviders(type)
	]);

	/*
	 * Кеша здесь не было вообще, и каждый заход в каталог заново дёргал TMDB:
	 * три страницы выдачи плюс жанры плюс провайдеров. stale-while-revalidate
	 * отдаёт готовую копию мгновенно и обновляет её в фоне — для каталога, который
	 * меняется раз в сутки, это именно то поведение, что нужно.
	 */
	setHeaders?.({ 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' });

	return {
		type,
		...result,
		genres,
		providers,
		filters,
		activeCount: countActive(filters),
		sortOptions: type === 'movie' ? SORT_OPTIONS : SORT_OPTIONS_TV,
		countries: COUNTRIES,
		statuses: SHOW_STATUS
	};
}

/** Форма данных страницы каталога — её принимает CatalogPage.svelte. */
export type CatalogPageData = Awaited<ReturnType<typeof loadCatalog>>;
