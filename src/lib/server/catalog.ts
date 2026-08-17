/**
 * Сервис каталога — единственное место, где TMDB и Jellyfin встречаются.
 *
 * Роуты не знают ни про демо-режим, ни про индекс: они просто спрашивают каталог
 * и получают CatalogItem с уже проставленным inLibrary.
 */

import type {
	CatalogItem,
	CollectionDetails,
	DiscoverFilters,
	DiscoverResult,
	EpisodeSummary,
	Keyword,
	MediaType,
	PersonDetails,
	TitleDetails,
	WatchProvider
} from '$lib/types';
import { config, libraryIndex, tmdb } from './config';
import * as demo from './demo-data';
import { COUNTRIES, NETWORKS, SHOW_STATUS, SORT_OPTIONS, SORT_OPTIONS_TV } from './tmdb';
import { archiveCount, archiveHighlights, markArchive } from './archive';
import { scrapersEnabled } from './sources/lightstream';

export { NETWORKS, SORT_OPTIONS, SORT_OPTIONS_TV, SHOW_STATUS, COUNTRIES };

/** Проставляет наличие в медиатеке. В демо-режиме данные уже размечены. */
function withPresence<T extends CatalogItem>(items: T[]): T[] {
	if (config.demoMode) return items;

	const marked = items.map((item) => {
		const entry =
			item.type === 'movie'
				? libraryIndex.findMovie(item.tmdbId)
				: libraryIndex.findShow(item.tmdbId);
		return { ...item, inLibrary: !!entry, jellyfinId: entry?.jellyfinId };
	});

	// Своя медиатека приоритетнее: архив добивает только то, чего в ней нет.
	const withArchive = markArchive(marked) as T[];

	// CDN-скраперы закрывают весь каталог — без них без Jellyfin смотреть нечего.
	if (scrapersEnabled()) {
		return withArchive.map((item) => (item.inLibrary ? item : { ...item, inLibrary: true }));
	}
	return withArchive;
}

export interface HomeRow {
	id: string;
	title: string;
	items: CatalogItem[];
	/** Куда ведёт «Все» в шапке ряда. */
	href?: string;
	/** Ряд с нумерацией — для топ-10. */
	ranked?: boolean;
}

/** Убирает повторы между рядами: один тайтл в трёх подборках выглядит как баг. */
function dedupeAcross(rows: HomeRow[]): HomeRow[] {
	const seen = new Set<string>();
	return rows.map((row) => {
		const items = row.items.filter((i) => {
			const key = `${i.type}:${i.tmdbId}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		return { ...row, items };
	});
}

export async function getHome(networkId?: number): Promise<{
	hero: CatalogItem[];
	rows: HomeRow[];
}> {
	if (config.demoMode || !tmdb) {
		const all = demo.demoAll();
		return {
			hero: demo.demoTrending().slice(0, 5),
			rows: [
				// Нумерованный ряд есть и в демо: демо-режим существует, чтобы смотреть
				// вёрстку, и без него главная в демо не совпадала с настоящей.
				{
					id: 'top-day',
					title: 'Топ-10 за сегодня',
					items: demo.demoTrending().slice(0, 10),
					ranked: true
				},
				{ id: 'library', title: 'Есть в медиатеке', items: all.filter((i) => i.inLibrary) },
				{ id: 'movies', title: 'Фильмы', items: demo.demoByType('movie'), href: '/catalog/movies' },
				{ id: 'shows', title: 'Сериалы', items: demo.demoByType('show'), href: '/catalog/shows' }
			]
		};
	}

	// Грузим ряды параллельно: последовательно это десять круговых задержек.
	const [
		trendingWeek,
		trendingDay,
		popularMovies,
		popularShows,
		topMovies,
		topShows,
		nowPlaying,
		onTheAir,
		russian,
		upcoming,
		network
	] = await Promise.all([
		tmdb.trending('all', 'week').catch(() => []),
		tmdb.trending('all', 'day').catch(() => []),
		tmdb.popular('movie').catch(() => []),
		tmdb.popular('show').catch(() => []),
		tmdb.topRated('movie').catch(() => []),
		tmdb.topRated('show').catch(() => []),
		tmdb.nowPlaying().catch(() => []),
		tmdb.onTheAir().catch(() => []),
		/*
			Русское кино — настоящая подборка, а не переименованный ряд: discover по
			языку оригинала. Порог голосов обязателен, иначе в популярном по языку
			всплывают тайтлы с двумя оценками, у которых даже постера нет.
		*/
		tmdb
			.discover('movie', { language: 'ru', minVotes: 50, sortBy: 'popularity.desc' })
			.then((r) => r.items)
			.catch(() => []),
		// «Скоро в кино» вместо «Бесплатно на стримингах»: бесплатного в регионе
		// почти нет, а премьер человек ждёт всегда.
		tmdb.upcoming().catch(() => []),
		networkId ? tmdb.byNetwork(networkId).catch(() => []) : Promise.resolve([])
	]);

	const rows: HomeRow[] = [];

	if (networkId) {
		const name = NETWORKS.find((n) => n.id === networkId)?.name ?? 'Сеть';
		rows.push({ id: 'network', title: name, items: withPresence(network) });
	}

	/*
	 * ПОРЯДОК РЯДОВ задан заказчиком и держится буквально: топ дня, тренд недели,
	 * сейчас в кино, популярные фильмы, популярные сериалы, новые серии, лучшие
	 * фильмы, лучшие сериалы, русское кино, скоро в кино.
	 *
	 * Ряд архива общественного достояния переехал в самый низ. Совсем убирать его
	 * нельзя: без подключённой медиатеки это единственное, что реально играется
	 * целиком, и без него у человека на всей главной не будет ни одной работающей
	 * кнопки «Смотреть». Но и второе место он занимать не должен — там его никто
	 * не просил.
	 */

	// Топ дня — нумерованный ряд из десяти. Ранжирование само по себе контент:
	// «почему это номер один» заставляет открыть карточку.
	rows.push({
		id: 'top-day',
		title: 'Топ-10 за сегодня',
		items: withPresence(trendingDay).slice(0, 10),
		ranked: true
	});

	rows.push(
		{ id: 'trending', title: 'В тренде за неделю', items: withPresence(trendingWeek) },
		{ id: 'now-playing', title: 'Сейчас в кино', items: withPresence(nowPlaying) },
		{
			id: 'popular-movies',
			title: 'Популярные фильмы',
			items: withPresence(popularMovies),
			href: '/catalog/movies'
		},
		{
			id: 'popular-shows',
			title: 'Популярные сериалы',
			items: withPresence(popularShows),
			href: '/catalog/shows'
		},
		{ id: 'on-the-air', title: 'Новые серии на этой неделе', items: withPresence(onTheAir) },
		{
			id: 'top-movies',
			title: 'Лучшие фильмы всех времён',
			items: withPresence(topMovies),
			href: '/catalog/movies?sort=vote_average.desc'
		},
		{
			id: 'top-shows',
			title: 'Лучшие сериалы',
			items: withPresence(topShows),
			href: '/catalog/shows?sort=vote_average.desc'
		},
		{
			id: 'russian',
			title: 'Русское кино',
			items: withPresence(russian),
			href: '/catalog/movies?lang=ru'
		},
		{ id: 'upcoming', title: 'Скоро в кино', items: withPresence(upcoming) }
	);

	// Архив — последним. Название короткое: длинная подпись «Смотреть бесплатно ·
	// общественное достояние» занимала полстроки и объясняла юридическую тонкость,
	// которая человеку в момент выбора не нужна.
	if (archiveCount > 0) {
		rows.push({ id: 'archive', title: 'Классика без подписки', items: archiveHighlights(18) });
	}

	/*
	 * Логотипы героя.
	 *
	 * Это единственный способ их получить: списочные эндпоинты TMDB (trending,
	 * popular, discover) поле logos не отдают вообще — только `/{type}/{id}/images`
	 * по одному тайтлу. Раньше герой пытался показать `hero.logo`, которого в
	 * данных никогда не было, и всегда падал в текстовый заголовок.
	 *
	 * Шесть запросов параллельно, с суточным кешем в клиенте — приемлемая цена
	 * ровно за первый экран. Делать то же для карточек в рядах нельзя: там их
	 * почти двести.
	 */
	const heroBase = withPresence(trendingWeek.filter((i) => i.backdrop).slice(0, 6));

	/*
	 * Логотип грузим ТОЛЬКО для первого слайда.
	 *
	 * В прошлой версии здесь было шесть параллельных запросов к TMDB, и все шесть
	 * задерживали первый байт главной. Но виден-то всегда один слайд: остальные
	 * пять логотипов нужны позже, когда карусель до них дойдёт. Их подтягивает
	 * клиент батчем через /api/logos — тем же механизмом, что и карточки.
	 */
	const firstLogo = heroBase.length
		? await tmdb.logo(heroBase[0].type, heroBase[0].tmdbId).catch(() => null)
		: null;

	/*
	 * Названия жанров подставляем только герою: их показывает строка фактов под
	 * названием, а справочник жанров кэширован на сутки, то есть запрос почти
	 * всегда бесплатный. Рядам это не нужно — там жанр появляется во всплывающей
	 * панели, которая и так дозагружает подробности.
	 */
	const heroWithGenres = await tmdb.withGenreNames(heroBase).catch(() => heroBase);

	const hero = heroWithGenres.map((item, i) =>
		i === 0 ? { ...item, logo: firstLogo ?? undefined } : item
	);

	return {
		// Герой: только то, у чего есть кадр — без backdrop слайд выглядит пустым.
		hero,
		rows: dedupeAcross(rows).filter((r) => r.items.length > 0)
	};
}

/* --------------------------------- поиск ---------------------------------- */

export async function searchCatalog(query: string, page = 1): Promise<DiscoverResult> {
	if (config.demoMode || !tmdb) {
		const items = demo.demoSearch(query);
		return { items, totalPages: 1, totalResults: items.length };
	}

	const result = await tmdb
		.search(query, page)
		.catch(() => ({ items: [] as CatalogItem[], totalPages: 0, totalResults: 0 }));

	return { ...result, items: withPresence(result.items) };
}

export async function searchPeople(query: string, limit = 12) {
	if (config.demoMode || !tmdb) return [];
	return tmdb.searchPeople(query, 1, limit).catch(() => []);
}

export async function searchKeywords(query: string): Promise<Keyword[]> {
	if (config.demoMode || !tmdb) return [];
	return tmdb.searchKeywords(query).catch(() => []);
}

/* -------------------------------- discover -------------------------------- */

export async function discover(type: MediaType, filters: DiscoverFilters): Promise<DiscoverResult> {
	if (config.demoMode || !tmdb) {
		const items = demo.demoByType(type);
		return {
			items: filters.onlyLibrary ? items.filter((i) => i.inLibrary) : items,
			totalPages: 1,
			totalResults: items.length
		};
	}

	const result = await tmdb
		.discover(type, filters)
		.catch(() => ({ items: [] as CatalogItem[], totalPages: 0, totalResults: 0 }));
	const marked = withPresence(result.items);

	return {
		...result,
		items: filters.onlyLibrary ? marked.filter((i) => i.inLibrary) : marked
	};
}

/**
 * Несколько страниц Discover за один заход.
 *
 * TMDB отдаёт ровно 20 позиций на страницу. На широком экране это три ряда —
 * каталог выглядел полупустым, хотя за ним стоят тысячи тайтлов. Тянем несколько
 * страниц параллельно: три запроса к TMDB укладываются в одну круговую задержку,
 * а пользователь получает шестьдесят карточек сразу.
 *
 * Возвращаем `nextPage`, чтобы клиент знал, откуда продолжать, и не считал
 * страницы сам.
 */
export async function discoverBatch(
	type: MediaType,
	filters: DiscoverFilters,
	pageCount = 3
): Promise<DiscoverResult & { nextPage: number | null }> {
	const first = filters.page ?? 1;

	if (config.demoMode || !tmdb) {
		const single = await discover(type, filters);
		return { ...single, nextPage: null };
	}

	// Первая страница отдельно: без неё неизвестно, сколько их всего, и можно
	// уйти за потолок TMDB в 500 страниц.
	const head = await discover(type, { ...filters, page: first });
	if (!head.items.length) return { ...head, nextPage: null };

	const lastWanted = Math.min(first + pageCount - 1, head.totalPages, 500);
	const rest = [];
	for (let p = first + 1; p <= lastWanted; p++) rest.push(p);

	const tails = await Promise.all(
		rest.map((p) => discover(type, { ...filters, page: p }).catch(() => null))
	);

	// Дедуп по ключу: соседние страницы Discover иногда пересекаются, когда
	// популярность тайтла меняется между запросами.
	const seen = new Set(head.items.map((i) => `${i.type}:${i.tmdbId}`));
	const items = [...head.items];
	for (const chunk of tails) {
		if (!chunk) continue;
		for (const item of chunk.items) {
			const key = `${item.type}:${item.tmdbId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push(item);
		}
	}

	return {
		items,
		totalPages: head.totalPages,
		totalResults: head.totalResults,
		nextPage: lastWanted < Math.min(head.totalPages, 500) ? lastWanted + 1 : null
	};
}

export async function getGenres(type: MediaType) {
	if (config.demoMode || !tmdb) {
		return [
			{ id: 18, name: 'Драма' },
			{ id: 28, name: 'Боевик' },
			{ id: 878, name: 'Фантастика' },
			{ id: 80, name: 'Криминал' },
			{ id: 35, name: 'Комедия' }
		];
	}
	return tmdb.genres(type).catch(() => []);
}

/** Провайдеры региона. Пустой список — нормальное состояние, не ошибка. */
export async function getProviders(type: MediaType): Promise<WatchProvider[]> {
	if (config.demoMode || !tmdb) return [];
	// Отсекаем длинный хвост мелких сервисов: 24 первых по приоритету хватает.
	return tmdb
		.watchProviders(type)
		.then((list) => list.slice(0, 24))
		.catch(() => []);
}

/* ------------------------------ детали тайтла ----------------------------- */

export async function getTitle(type: MediaType, tmdbId: number): Promise<TitleDetails | null> {
	if (config.demoMode || !tmdb) return demo.demoDetails(type, tmdbId);

	const details = await tmdb.details(type, tmdbId).catch(() => null);
	if (!details) return null;

	const [marked] = withPresence([details]);
	const show = type === 'show' ? libraryIndex.findShow(tmdbId) : undefined;

	// Считаем, сколько серий каждого сезона реально есть на диске.
	const seasons = details.seasons.map((s) => {
		if (!show) return s;
		const count = Object.values(show.episodes).filter((e) => e.season === s.seasonNumber).length;
		return { ...s, inLibraryCount: count };
	});

	return {
		...details,
		inLibrary: marked.inLibrary,
		jellyfinId: marked.jellyfinId,
		seasons,
		similar: withPresence(details.similar),
		recommendations: withPresence(details.recommendations)
	};
}

/**
 * Краткие данные тайтла с пометкой доступности.
 *
 * Ровно то, что нужно странице просмотра: название для заголовка, кадр для
 * экрана ожидания и признак «это можно включить». Полные детали там не нужны.
 */
export async function getTitleBrief(type: MediaType, tmdbId: number): Promise<CatalogItem | null> {
	if (config.demoMode || !tmdb) {
		const details = demo.demoDetails(type, tmdbId);
		return details ?? null;
	}

	const item = await tmdb.brief(type, tmdbId).catch(() => null);
	if (!item) return null;

	const [marked] = withPresence([item]);
	return marked;
}

/**
 * Подробности для всплывающей панели карточки. См. api/preview.
 *
 * В демо-режиме собираем из встроенных данных: панель должна работать и там,
 * иначе её нельзя ни посмотреть, ни проверить без ключа TMDB.
 */
export async function getTitlePreview(
	type: MediaType,
	tmdbId: number
): Promise<{
	genres: string[];
	ageRating?: string;
	runtimeMin?: number;
	rating?: number;
	votes?: number;
	overview?: string;
} | null> {
	if (config.demoMode || !tmdb) {
		const d = demo.demoDetails(type, tmdbId);
		if (!d) return null;
		return {
			genres: d.genreRefs.map((g) => g.name),
			ageRating: d.ageRating,
			runtimeMin: d.runtimeMin,
			rating: d.rating,
			votes: d.votes,
			overview: d.overview
		};
	}

	return await tmdb.preview(type, tmdbId).catch(() => null);
}

export async function getEpisodes(tmdbId: number, season: number): Promise<EpisodeSummary[]> {
	if (config.demoMode || !tmdb) return demo.demoEpisodes(tmdbId, season);

	const episodes = await tmdb.episodes(tmdbId, season).catch(() => []);
	const show = libraryIndex.findShow(tmdbId);

	return episodes.map((e) => {
		const entry = show
			? Object.values(show.episodes).find(
					(x) => x.season === e.seasonNumber && x.episode === e.episodeNumber
				)
			: undefined;
		// Серии вне медиатеки играются через CDN-скраперы, если они включены.
		return { ...e, inLibrary: !!entry || scrapersEnabled(), jellyfinId: entry?.jellyfinId };
	});
}

/* --------------------------- персона и франшиза --------------------------- */

export async function getPerson(id: number): Promise<PersonDetails | null> {
	if (config.demoMode || !tmdb) return null;

	const person = await tmdb.person(id).catch(() => null);
	if (!person) return null;

	return {
		...person,
		acting: withPresence(person.acting),
		crew: withPresence(person.crew)
	};
}

export async function getCollection(id: number): Promise<CollectionDetails | null> {
	if (config.demoMode || !tmdb) return null;

	const collection = await tmdb.collection(id).catch(() => null);
	if (!collection) return null;

	return { ...collection, parts: withPresence(collection.parts) };
}

export async function getKeyword(id: number): Promise<Keyword | null> {
	if (config.demoMode || !tmdb) return null;
	return tmdb.keyword(id).catch(() => null);
}
