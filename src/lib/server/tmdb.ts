/**
 * Клиент TMDB — источник каталога и метаданных.
 *
 * Jellyfin знает только то, что лежит на диске. Чтобы главная и подборки
 * выглядели полноценно, каталог берём из TMDB, а Jellyfin отвечает лишь на
 * вопрос «это можно включить прямо сейчас».
 *
 * Три вещи, которые сделаны намеренно и на которые легко наступить:
 *
 * 1. ФОЛБЭК ЯЗЫКА. TMDB не откатывается на английский сам: при language=ru-RU
 *    у тайтла без русского перевода приезжает overview: "" — пустая строка, не
 *    null. Поэтому в details мы просим append_to_response=translations и
 *    выбираем текст цепочкой ru -> en одним запросом, а не двумя.
 *
 * 2. АГРЕГИРОВАННЫЕ ТИТРЫ. /tv/{id}/credits отдаёт состав ТОЛЬКО последнего
 *    сезона. Полный состав сериала — это aggregate_credits с другой формой
 *    ответа: roles[] с episode_count вместо character.
 *
 * 3. ПОРОГ ГОЛОСОВ. sort_by=vote_average.desc без vote_count.gte поднимает
 *    наверх тайтлы с двумя голосами и оценкой 10.0. Порог задаётся всегда.
 */

import type {
	CatalogItem,
	CollectionDetails,
	CrewGroup,
	DiscoverFilters,
	DiscoverResult,
	EpisodeGroup,
	ImageGallery,
	Keyword,
	MediaType,
	Person,
	PersonCredit,
	PersonDetails,
	Review,
	TitleDetails,
	WatchOffers,
	WatchProvider
} from '$lib/types';

const API = 'https://api.themoviedb.org/3';
const IMG_DIRECT = 'https://image.tmdb.org/t/p';

/* ------------------------------- картинки -------------------------------- */

/**
 * Все картинки идут через собственный прокси /api/img: у части провайдеров
 * image.tmdb.org недоступен напрямую. Размер выбираем осознанно — original в
 * сетке постеров это до 2000px на карточку.
 */
const proxied = (size: string, path?: string | null) =>
	path ? `/api/img?src=${encodeURIComponent(`/${size}${path}`)}` : undefined;

export const posterUrl = (path?: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') =>
	proxied(size, path);

export const backdropUrl = (path?: string | null, size: 'w780' | 'w1280' | 'original' = 'w1280') =>
	proxied(size, path);

export const profileUrl = (path?: string | null, size: 'w185' | 'h632' = 'w185') =>
	proxied(size, path);

export const stillUrl = (path?: string | null, size: 'w300' | 'original' = 'w300') =>
	proxied(size, path);

export const logoUrl = (path?: string | null, size: 'w185' | 'w300' | 'w500' = 'w500') =>
	proxied(size, path);

/**
 * Полный размер для просмотрщика. Отдельная функция, а не параметр к
 * posterUrl/backdropUrl: у оригинала нет размерных вариантов, и вызывать его
 * надо осознанно — это до нескольких мегабайт на картинку.
 */
export const proxiedOriginal = (path?: string | null) => proxied('original', path);

/** Прямой URL — для og:image и прочих мест, где краулеру нужен абсолютный адрес. */
export const absoluteImageUrl = (path?: string | null, size = 'original') =>
	path ? `${IMG_DIRECT}/${size}${path}` : undefined;

/* ------------------------------- сырые типы ------------------------------- */

interface TmdbItem {
	id: number;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	overview?: string;
	poster_path?: string | null;
	backdrop_path?: string | null;
	profile_path?: string | null;
	release_date?: string;
	first_air_date?: string;
	vote_average?: number;
	vote_count?: number;
	genre_ids?: number[];
	genres?: { id: number; name: string }[];
	media_type?: string;
	runtime?: number;
	episode_run_time?: number[];
	popularity?: number;
}

interface TmdbPage<T> {
	page: number;
	results: T[];
	total_pages: number;
	total_results: number;
}

interface TmdbTranslation {
	iso_639_1: string;
	data?: { title?: string; name?: string; overview?: string; tagline?: string; biography?: string };
}

interface TmdbImage {
	file_path: string;
	iso_639_1: string | null;
	vote_average?: number;
	aspect_ratio?: number;
}

/* ------------------------------ кеш в памяти ------------------------------ */

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

class TtlCache {
	private map = new Map<string, CacheEntry>();

	constructor(private readonly maxEntries = 800) {}

	get<T>(key: string): T | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		if (hit.expiresAt < Date.now()) {
			this.map.delete(key);
			return undefined;
		}
		// Освежаем позицию — грубый LRU.
		this.map.delete(key);
		this.map.set(key, hit);
		return hit.value as T;
	}

	set(key: string, value: unknown, ttlMs: number): void {
		if (this.map.size >= this.maxEntries) {
			const oldest = this.map.keys().next().value;
			if (oldest) this.map.delete(oldest);
		}
		this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
	}
}

/* ------------------------------- хелперы --------------------------------- */

/**
 * Выбор текста с фолбэком. Единственное место, где решается «что показать,
 * если русского перевода нет» — все текстовые поля идут через него.
 */
function pickLocalized(
	primary: string | undefined,
	translations: TmdbTranslation[] | undefined,
	field: 'overview' | 'tagline' | 'title' | 'biography',
	chain: string[]
): string | undefined {
	if (primary && primary.trim()) return primary;
	if (!translations?.length) return undefined;

	for (const lang of chain) {
		const hit = translations.find((t) => t.iso_639_1 === lang);
		const value = field === 'title' ? (hit?.data?.title ?? hit?.data?.name) : hit?.data?.[field];
		if (value && value.trim()) return value;
	}
	return undefined;
}

/** Лучшая картинка языковой цепочкой, затем по рейтингу. */
function pickImage(
	images: TmdbImage[] | undefined,
	chain: (string | null)[]
): TmdbImage | undefined {
	if (!images?.length) return undefined;
	for (const lang of chain) {
		const matches = images.filter((i) => i.iso_639_1 === lang);
		if (matches.length) {
			return matches.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
		}
	}
	return images[0];
}

const yearOf = (date?: string) => {
	const y = date ? Number.parseInt(date.slice(0, 4), 10) : NaN;
	return Number.isFinite(y) ? y : undefined;
};

/** Списки TMDB: запятая = AND, вертикальная черта = OR. */
const joinAnd = (ids?: number[]) => (ids?.length ? ids.join(',') : undefined);
const joinOr = (ids?: number[]) => (ids?.length ? ids.join('|') : undefined);

const round1 = (n: number) => Math.round(n * 10) / 10;

/* --------------------------------- клиент --------------------------------- */

export class TmdbClient {
	private cache = new TtlCache();
	/** Цепочка фолбэка текста: ru -> en. Строится из настроенного языка. */
	private readonly langChain: string[];

	constructor(
		private readonly apiKey: string,
		private readonly language = 'ru-RU',
		private readonly region = 'RU',
		/** v4 read token. Если задан — работает и для v3, и для v4. */
		private readonly readToken = ''
	) {
		const short = language.slice(0, 2);
		this.langChain = short === 'en' ? ['en'] : [short, 'en'];
	}

	private async get<T>(path: string, query: Record<string, unknown> = {}, ttlMs = 3_600_000) {
		const u = new URL(API + path);
		if (!this.readToken) u.searchParams.set('api_key', this.apiKey);
		u.searchParams.set('language', this.language);
		for (const [k, v] of Object.entries(query)) {
			if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
		}

		const key = u.toString().replace(this.apiKey, '');
		const cached = this.cache.get<T>(key);
		if (cached) return cached;

		const headers: Record<string, string> = { Accept: 'application/json' };
		if (this.readToken) headers.Authorization = `Bearer ${this.readToken}`;

		// Таймаут страхует от зависшего TMDB: без него resolve мог ждать весь
		// бюджет serverless-функции, хотя scrape API работает и без IMDb ID.
		const res = await fetch(u, { headers, signal: AbortSignal.timeout(8_000) });
		if (!res.ok) throw new Error(`TMDB ${res.status} на ${path}`);

		const json = (await res.json()) as T;
		this.cache.set(key, json, ttlMs);
		return json;
	}

	private map(raw: TmdbItem[], forceType?: MediaType): CatalogItem[] {
		// Именно лямбда: голая передача toCatalogItem получила бы вторым
		// аргументом индекс массива, и тип всех тайтлов ломался.
		return raw.map((x) => toCatalogItem(x, forceType)).filter(Boolean) as CatalogItem[];
	}

	/* ------------------------------ подборки ------------------------------- */

	async trending(type: 'all' | 'movie' | 'tv' = 'all', window: 'day' | 'week' = 'week') {
		const r = await this.get<TmdbPage<TmdbItem>>(
			`/trending/${type}/${window}`,
			{},
			window === 'day' ? 21_600_000 : 43_200_000
		);
		return this.map(r.results.filter((x) => x.media_type !== 'person'));
	}

	async popular(type: MediaType, page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			type === 'movie' ? '/movie/popular' : '/tv/popular',
			// region есть у movie-подборок, у TV вместо него timezone.
			type === 'movie' ? { page, region: this.region } : { page }
		);
		return this.map(r.results, type);
	}

	async topRated(type: MediaType, page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			type === 'movie' ? '/movie/top_rated' : '/tv/top_rated',
			{ page }
		);
		return this.map(r.results, type);
	}

	/** Сейчас в кино — с региональными датами. */
	async nowPlaying(page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			'/movie/now_playing',
			{ page, region: this.region },
			21_600_000
		);
		return this.map(r.results, 'movie');
	}

	async upcoming(page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			'/movie/upcoming',
			{ page, region: this.region },
			21_600_000
		);
		return this.map(r.results, 'movie');
	}

	/** Сериалы, у которых серии выходят на этой неделе. */
	async onTheAir(page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			'/tv/on_the_air',
			{ page, timezone: 'Europe/Moscow' },
			21_600_000
		);
		return this.map(r.results, 'show');
	}

	/** Подборка по стриминговой сети. */
	async byNetwork(networkId: number, page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>('/discover/tv', {
			with_networks: networkId,
			sort_by: 'popularity.desc',
			page
		});
		return this.map(r.results, 'show');
	}

	/**
	 * Бесплатно со стримингов в регионе — ряд, которого почти ни у кого нет.
	 * Требует и watch_region, и with_watch_monetization_types: без региона
	 * фильтр провайдеров молча игнорируется.
	 */
	async freeToWatch(type: MediaType, page = 1) {
		const r = await this.get<TmdbPage<TmdbItem>>(
			type === 'movie' ? '/discover/movie' : '/discover/tv',
			{
				watch_region: this.region,
				with_watch_monetization_types: 'free|ads',
				sort_by: 'popularity.desc',
				'vote_count.gte': 50,
				page
			},
			21_600_000
		);
		return this.map(r.results, type);
	}

	/* -------------------------------- discover ------------------------------ */

	/**
	 * Полный Discover. Раньше здесь было четыре параметра, теперь — тот набор,
	 * на котором реально работает подбор: ключевые слова, длительность, люди,
	 * провайдеры, статус сериала.
	 */
	async discover(type: MediaType, f: DiscoverFilters): Promise<DiscoverResult> {
		const isMovie = type === 'movie';
		const sortBy = f.sortBy ?? 'popularity.desc';

		// Порог голосов: явный, иначе разумный по контексту сортировки.
		const minVotes =
			f.minVotes ??
			(sortBy.startsWith('vote_average')
				? isMovie
					? 300
					: 200
				: f.minRating
					? 50
					: undefined);

		const query: Record<string, unknown> = {
			sort_by: sortBy,
			page: f.page ?? 1,
			include_adult: false,
			// AND-логика через запятую даёт «и боевик, и фантастика» вместо «или».
			with_genres: f.genresMatchAll ? joinAnd(f.genres) : joinOr(f.genres),
			without_genres: joinOr(f.excludeGenres),
			with_keywords: joinOr(f.keywords),
			without_keywords: joinOr(f.excludeKeywords),
			with_origin_country: f.country,
			with_original_language: f.language,
			with_companies: joinOr(f.companies),
			'vote_average.gte': f.minRating,
			'vote_average.lte': f.maxRating,
			'vote_count.gte': minVotes,
			'with_runtime.gte': f.runtimeFrom,
			'with_runtime.lte': f.runtimeTo
		};

		if (f.providers?.length) {
			query.with_watch_providers = joinOr(f.providers);
			query.watch_region = this.region;
		}
		if (f.monetization?.length) {
			query.with_watch_monetization_types = f.monetization.join('|');
			query.watch_region = this.region;
		}

		if (isMovie) {
			// with_people есть только у фильмов; для сериалов такого фильтра TMDB
			// не даёт — там пришлось бы идти через /person/{id}/tv_credits.
			query.with_people = joinOr(f.people);
			query.region = this.region;
			if (f.yearFrom) query['primary_release_date.gte'] = `${f.yearFrom}-01-01`;
			if (f.yearTo) query['primary_release_date.lte'] = `${f.yearTo}-12-31`;
		} else {
			query.with_networks = f.networks?.length ? f.networks[0] : undefined;
			query.with_status = joinOr(f.showStatus);
			query.include_null_first_air_dates = false;
			if (f.yearFrom) query['first_air_date.gte'] = `${f.yearFrom}-01-01`;
			if (f.yearTo) query['first_air_date.lte'] = `${f.yearTo}-12-31`;
		}

		const r = await this.get<TmdbPage<TmdbItem>>(
			isMovie ? '/discover/movie' : '/discover/tv',
			query,
			1_800_000
		);

		return {
			items: this.map(r.results, type),
			// Жёсткий потолок TMDB — 500 страниц, дальше приходит ошибка.
			totalPages: Math.min(r.total_pages, 500),
			totalResults: r.total_results
		};
	}

	/* --------------------------------- поиск -------------------------------- */

	/**
	 * Поиск по тайтлам. Возвращает и счётчики страниц: странице поиска нужна
	 * догрузка, а подсказкам — понимание, есть ли что-то ещё кроме показанного.
	 */
	async search(query: string, page = 1): Promise<DiscoverResult> {
		if (!query.trim()) return { items: [], totalPages: 0, totalResults: 0 };
		const r = await this.get<TmdbPage<TmdbItem>>(
			'/search/multi',
			{ query, page, include_adult: false },
			300_000
		);
		return {
			// multi отдаёт ещё и персон — их забирает searchPeople отдельным блоком.
			items: this.map(
				r.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
			),
			totalPages: Math.min(r.total_pages, 500),
			totalResults: r.total_results
		};
	}

	/** Персоны в поиске — отдельным блоком, у них своя карточка. */
	async searchPeople(query: string, page = 1, limit = 12) {
		if (!query.trim()) return [];
		const r = await this.get<TmdbPage<TmdbItem & { known_for?: TmdbItem[] }>>(
			'/search/person',
			{ query, page, include_adult: false },
			300_000
		);
		return r.results.slice(0, limit).map((p) => ({
			id: p.id,
			name: p.name ?? '',
			photo: profileUrl(p.profile_path),
			knownFor: (p.known_for ?? [])
				.map((k) => k.title ?? k.name)
				.filter(Boolean)
				.slice(0, 3)
				.join(', ')
		}));
	}

	/** Ключевые слова для автокомплита в подборе. */
	async searchKeywords(query: string): Promise<Keyword[]> {
		if (!query.trim()) return [];
		const r = await this.get<TmdbPage<{ id: number; name: string }>>(
			'/search/keyword',
			{ query },
			3_600_000
		);
		return r.results.slice(0, 20);
	}

	/**
	 * Подставляет названия жанров элементам списков.
	 *
	 * Списочные ответы TMDB (trending, popular, discover) отдают только genre_ids,
	 * без имён — поэтому на карточках под названием стоял один год, хотя жанр
	 * известен. Справочник жанров кэшируется на сутки, то есть дополнительных
	 * обращений к TMDB здесь практически нет, а сама подстановка локальная.
	 *
	 * Оба справочника (фильмы и сериалы) грузятся сразу: в общих подборках
	 * вроде «в тренде» рядом лежат и фильмы, и сериалы, а наборы жанров у них
	 * разные.
	 */
	async withGenreNames<T extends CatalogItem>(items: T[]): Promise<T[]> {
		if (!items.some((i) => i.genreIds?.length && !i.genres?.length)) return items;

		const [movie, show] = await Promise.all([
			this.genres('movie').catch(() => []),
			this.genres('show').catch(() => [])
		]);
		if (!movie.length && !show.length) return items;

		const byId = new Map<number, string>();
		for (const g of [...movie, ...show]) byId.set(g.id, g.name);

		return items.map((item) =>
			item.genres?.length || !item.genreIds?.length
				? item
				: {
						...item,
						genres: item.genreIds
							.map((id) => byId.get(id))
							.filter((n): n is string => Boolean(n))
					}
		);
	}

	async genres(type: MediaType): Promise<{ id: number; name: string }[]> {
		const r = await this.get<{ genres: { id: number; name: string }[] }>(
			type === 'movie' ? '/genre/movie/list' : '/genre/tv/list',
			{},
			86_400_000
		);
		return r.genres;
	}

	/** Провайдеры региона для фильтра «где смотреть». */
	async watchProviders(type: MediaType): Promise<WatchProvider[]> {
		const r = await this.get<{
			results: {
				provider_id: number;
				provider_name: string;
				logo_path?: string;
				display_priority: number;
			}[];
		}>(
			type === 'movie' ? '/watch/providers/movie' : '/watch/providers/tv',
			{ watch_region: this.region },
			86_400_000
		);
		return r.results
			.map((p) => ({
				id: p.provider_id,
				name: p.provider_name,
				logo: logoUrl(p.logo_path, 'w185'),
				priority: p.display_priority
			}))
			.sort((a, b) => a.priority - b.priority);
	}

	/* ----------------------------- детали тайтла ---------------------------- */

	async details(type: MediaType, tmdbId: number): Promise<TitleDetails> {
		const isMovie = type === 'movie';

		// Один запрос вместо восьми. append_to_response ограничен 20 ресурсами,
		// мы просим 11-12. Пагинируемые ресурсы (similar, reviews) отдают только
		// первую страницу — для карточки этого достаточно.
		const append = isMovie
			? 'credits,videos,similar,recommendations,images,keywords,translations,release_dates,watch/providers,external_ids,reviews'
			: 'aggregate_credits,videos,similar,recommendations,images,keywords,translations,content_ratings,watch/providers,external_ids,reviews,episode_groups';

		const raw = await this.get<RawDetails>(`/${isMovie ? 'movie' : 'tv'}/${tmdbId}`, {
			append_to_response: append,
			// Без этого при language=ru-RU приезжают только русские картинки, а
			// логотипов на русском у большинства тайтлов нет вовсе.
			include_image_language: `${this.langChain.join(',')},null`
		});

		const base = toCatalogItem(raw, type);
		if (!base) throw new Error(`TMDB: пустой ответ по ${type}/${tmdbId}`);

		const translations = raw.translations?.translations;
		const overview = pickLocalized(raw.overview, translations, 'overview', this.langChain);
		const tagline = pickLocalized(raw.tagline, translations, 'tagline', this.langChain);

		// Логотип тайтла: прозрачный PNG с типографикой названия. Уже грузился,
		// но нигде не использовался — теперь это заголовок героя.
		const logo = pickImage(raw.images?.logos, [...this.langChain, null]);

		const trailer =
			raw.videos?.results?.find(
				(v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official
			) ??
			raw.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
			raw.videos?.results?.find((v) => v.site === 'YouTube');

		const runtimeMin = isMovie ? raw.runtime : raw.episode_run_time?.[0];

		return {
			...base,
			overview,
			tagline,
			logo: logoUrl(logo?.file_path),
			runtimeSec: runtimeMin ? runtimeMin * 60 : undefined,
			runtimeMin: runtimeMin || undefined,
			countries: raw.production_countries?.map((c) => c.name),
			genres: raw.genres?.map((g) => g.name),
			genreRefs: raw.genres ?? [],
			ageRating: isMovie ? this.movieAgeRating(raw) : this.showAgeRating(raw),
			cast: isMovie ? mapMovieCast(raw) : mapAggregateCast(raw),
			crew: mapCrew(raw, isMovie),
			trailerKey: trailer?.key,
			videos: (raw.videos?.results ?? [])
				.filter((v) => v.site === 'YouTube')
				.slice(0, 12)
				.map((v) => ({ key: v.key, name: v.name ?? v.type, type: v.type })),
			seasons: (raw.seasons ?? [])
				// Нулевой сезон — спецвыпуски, в основной список не тащим.
				.filter((s) => s.season_number > 0)
				.map((s) => ({
					seasonNumber: s.season_number,
					name: s.name,
					episodeCount: s.episode_count,
					poster: posterUrl(s.poster_path),
					airDate: s.air_date,
					overview: s.overview || undefined,
					rating: s.vote_average ? round1(s.vote_average) : undefined,
					inLibraryCount: 0 // заполняется из индекса на уровне выше
				})),
			similar: this.map(raw.similar?.results ?? [], type).slice(0, 18),
			recommendations: this.map(raw.recommendations?.results ?? [], type).slice(0, 18),
			// Форма ответа keywords у фильмов и сериалов разная: keywords vs results.
			keywords: (isMovie ? raw.keywords?.keywords : raw.keywords?.results) ?? [],
			providers: mapProviders(raw['watch/providers']?.results?.[this.region]),
			facts: {
				status: raw.status,
				budget: raw.budget || undefined,
				revenue: raw.revenue || undefined,
				originalLanguage: raw.original_language,
				companies: (raw.production_companies ?? []).map((c) => ({
					id: c.id,
					name: c.name,
					logo: logoUrl(c.logo_path, 'w185')
				})),
				networks: (raw.networks ?? []).map((n) => ({
					id: n.id,
					name: n.name,
					logo: logoUrl(n.logo_path, 'w185')
				})),
				...this.releaseDates(raw)
			},
			gallery: mapGallery(raw.images),
			reviews: mapReviews(raw.reviews?.results),
			collection: raw.belongs_to_collection
				? {
						id: raw.belongs_to_collection.id,
						name: raw.belongs_to_collection.name,
						poster: posterUrl(raw.belongs_to_collection.poster_path),
						backdrop: backdropUrl(raw.belongs_to_collection.backdrop_path)
					}
				: undefined,
			nextEpisode: mapEpisodeStub(raw.next_episode_to_air),
			lastEpisode: mapEpisodeStub(raw.last_episode_to_air),
			episodeGroups: mapEpisodeGroups(raw.episode_groups?.results),
			imdbId: raw.external_ids?.imdb_id || undefined,
			homepage: raw.homepage || undefined,
			totalEpisodes: raw.number_of_episodes
		};
	}

	/** Возрастной рейтинг фильма для региона. В /certification/movie/list RU нет. */
	private movieAgeRating(raw: RawDetails): string | undefined {
		const region = raw.release_dates?.results?.find((r) => r.iso_3166_1 === this.region);
		return region?.release_dates?.find((d) => d.certification)?.certification || undefined;
	}

	private showAgeRating(raw: RawDetails): string | undefined {
		const region = raw.content_ratings?.results?.find((r) => r.iso_3166_1 === this.region);
		return region?.rating || undefined;
	}

	/** Раздельные даты: кино (type 3/2) и цифра (type 4). */
	private releaseDates(raw: RawDetails) {
		const region = raw.release_dates?.results?.find((r) => r.iso_3166_1 === this.region);
		const dates = region?.release_dates ?? [];
		return {
			theatricalDate: dates.find((d) => d.type === 3 || d.type === 2)?.release_date,
			digitalDate: dates.find((d) => d.type === 4)?.release_date
		};
	}

	/** Внешние ID (IMDb и др.) — нужны CDN-скраперам, ключирующимся по IMDb. */
	async externalIds(type: MediaType, tmdbId: number): Promise<{ imdbId?: string }> {
		const r = await this.get<{ imdb_id?: string }>(
			`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}/external_ids`,
			{},
			86_400_000
		);
		return { imdbId: r.imdb_id || undefined };
	}

	async episodes(tmdbId: number, seasonNumber: number) {
		const r = await this.get<{
			episodes: {
				episode_number: number;
				season_number: number;
				name: string;
				overview?: string;
				still_path?: string | null;
				runtime?: number;
				air_date?: string;
				vote_average?: number;
			}[];
		}>(`/tv/${tmdbId}/season/${seasonNumber}`);

		return (r.episodes ?? []).map((e) => ({
			seasonNumber: e.season_number,
			episodeNumber: e.episode_number,
			name: e.name,
			overview: e.overview || undefined,
			still: stillUrl(e.still_path),
			runtimeSec: e.runtime ? e.runtime * 60 : undefined,
			airDate: e.air_date,
			rating: e.vote_average ? round1(e.vote_average) : undefined,
			inLibrary: false // заполняется из индекса
		}));
	}

	/* -------------------------------- персона ------------------------------- */

	async person(id: number): Promise<PersonDetails | null> {
		const raw = await this.get<RawPerson>(`/person/${id}`, {
			append_to_response: 'combined_credits,images,external_ids,translations'
		});
		if (!raw?.id) return null;

		// Биографию TMDB тоже не откатывает на английский. Имена персон при
		// language=ru-RU не переводятся вообще — это ограничение API.
		const biography = pickLocalized(
			raw.biography,
			raw.translations?.translations,
			'biography',
			this.langChain
		);

		const toCredit = (c: RawCredit): PersonCredit | null => {
			const type: MediaType = c.media_type === 'tv' ? 'show' : 'movie';
			const item = toCatalogItem(c, type);
			if (!item) return null;
			return { ...item, character: c.character, job: c.job, department: c.department };
		};

		const byYearDesc = (a: PersonCredit, b: PersonCredit) => (b.year ?? 0) - (a.year ?? 0);

		return {
			id: raw.id,
			name: raw.name,
			photo: profileUrl(raw.profile_path, 'h632'),
			biography,
			birthday: raw.birthday || undefined,
			deathday: raw.deathday || undefined,
			placeOfBirth: raw.place_of_birth || undefined,
			knownFor: raw.known_for_department || undefined,
			popularity: raw.popularity,
			imdbId: raw.external_ids?.imdb_id || undefined,
			// filter(Boolean) не сужает тип, поэтому предикат явный: без него sort
			// получает (PersonCredit | null)[] и падает на проверке типов.
			acting: (raw.combined_credits?.cast ?? [])
				.map(toCredit)
				.filter((c): c is PersonCredit => c !== null)
				.sort(byYearDesc),
			crew: (raw.combined_credits?.crew ?? [])
				.map(toCredit)
				.filter((c): c is PersonCredit => c !== null)
				.sort(byYearDesc),
			/*
				Полный размер тоже через прокси, а не прямой ссылкой на TMDB.

				Прямая ссылка здесь была ошибкой: прокси существует именно потому, что
				у части провайдеров image.tmdb.org не открывается, — и просмотрщик
				вместо фотографии показывал вечную размытую заглушку. Абсолютные
				адреса остаются только для og:image, где их читает краулер.
			*/
			photos: (raw.images?.profiles ?? []).slice(0, 12).map((p) => ({
				url: profileUrl(p.file_path, 'h632')!,
				full: proxiedOriginal(p.file_path)!
			}))
		};
	}

	/* -------------------------------- превью --------------------------------- */

	/**
	 * Подробности для всплывающей панели карточки.
	 *
	 * Зачем отдельный метод. Панели нужны жанры, возрастной рейтинг и
	 * длительность — ровно то, чего нет в списочных ответах TMDB: там только
	 * genre_ids, и ни возраста, ни длительности. Просить это заранее для всей
	 * страницы нельзя: в сетке до сорока карточек, то есть сорок запросов ради
	 * данных, которые понадобятся у одной-двух.
	 *
	 * Полный `details` для той же цели не годится: он тянет одиннадцать ресурсов
	 * через append_to_response (титры, галерею, отзывы, переводы) — сотни
	 * килобайт ради трёх полей. Здесь append ровно один и только тот, из которого
	 * берётся возрастной рейтинг.
	 *
	 * Кэш суточный: возраст и длительность у вышедшего тайтла не меняются.
	 */
	async preview(
		type: MediaType,
		tmdbId: number
	): Promise<{
		genres: string[];
		ageRating?: string;
		runtimeMin?: number;
		rating?: number;
		votes?: number;
		overview?: string;
	}> {
		const isMovie = type === 'movie';
		const raw = await this.get<RawDetails>(
			`/${isMovie ? 'movie' : 'tv'}/${tmdbId}`,
			{ append_to_response: isMovie ? 'release_dates' : 'content_ratings' },
			86_400_000
		);

		const runtimeMin = isMovie ? raw.runtime : raw.episode_run_time?.[0];

		return {
			genres: (raw.genres ?? []).map((g) => g.name),
			ageRating: isMovie ? this.movieAgeRating(raw) : this.showAgeRating(raw),
			runtimeMin: runtimeMin || undefined,
			rating: raw.vote_average ? round1(raw.vote_average) : undefined,
			votes: raw.vote_count || undefined,
			// Пустая строка вместо null — обычное дело у TMDB без перевода.
			overview: raw.overview || undefined
		};
	}

	/* ------------------------------- франшиза ------------------------------- */

	async collection(id: number): Promise<CollectionDetails | null> {
		const raw = await this.get<{
			id: number;
			name: string;
			overview?: string;
			poster_path?: string | null;
			backdrop_path?: string | null;
			parts?: TmdbItem[];
		}>(`/collection/${id}`, {}, 86_400_000);
		if (!raw?.id) return null;

		return {
			id: raw.id,
			name: raw.name,
			overview: raw.overview || undefined,
			poster: posterUrl(raw.poster_path),
			backdrop: backdropUrl(raw.backdrop_path),
			// Части франшизы по году возр. — это хронология, а не рейтинг.
			parts: this.map(raw.parts ?? [], 'movie').sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
		};
	}

	/* ------------------------------ краткие данные --------------------------- */

	/**
	 * Минимальные данные тайтла: название, постер, кадр, год.
	 *
	 * Нужен странице просмотра. Она вызывала полный `details`, а тот тянет
	 * append_to_response из одиннадцати ресурсов — титры, видео, галерею, отзывы,
	 * переводы, провайдеров — чтобы взять оттуда ОДНУ строку с названием. Ответ на
	 * несколько сотен килобайт вместо пары, и всё это до первого байта страницы.
	 *
	 * Здесь запрос без append: он и быстрее сам, и кешируется отдельно от тяжёлого.
	 */
	async brief(type: MediaType, tmdbId: number): Promise<CatalogItem | null> {
		const raw = await this.get<TmdbItem>(
			`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`,
			{},
			21_600_000
		);
		return toCatalogItem(raw, type);
	}

	/* ------------------------------- логотипы ------------------------------- */

	/**
	 * Логотип тайтла — прозрачный PNG с оригинальной типографикой названия.
	 *
	 * Отдельный метод нужен потому, что списочные эндпоинты (discover, trending,
	 * popular) логотипы НЕ отдают вообще — только `/images` по одному тайтлу.
	 * Поэтому карточки в рядах догружают их лениво и батчами, см. /api/logos.
	 *
	 * Кеш на сутки: набор логотипов у тайтла практически не меняется.
	 */
	async logo(type: MediaType, tmdbId: number): Promise<string | null> {
		const r = await this.get<{ logos?: TmdbImage[] }>(
			`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}/images`,
			{ include_image_language: `${this.langChain.join(',')},null` },
			86_400_000
		);
		// Широкие логотипы читаются лучше на узкой карточке, поэтому предпочитаем
		// горизонтальные: aspect_ratio > 1.6 — это «лежачая» типографика.
		const wide = (r.logos ?? []).filter((l) => (l.aspect_ratio ?? 0) >= 1.6);
		const best = pickImage(wide.length ? wide : r.logos, [...this.langChain, null]);
		return logoUrl(best?.file_path, 'w300') ?? null;
	}

	/* ---------------------------- ключевое слово ---------------------------- */

	async keyword(id: number): Promise<Keyword | null> {
		const r = await this.get<{ id: number; name: string }>(`/keyword/${id}`, {}, 86_400_000);
		return r?.id ? r : null;
	}
}

/* ------------------------------ преобразование ----------------------------- */

function toCatalogItem(raw: TmdbItem, forceType?: MediaType): CatalogItem | null {
	const type: MediaType =
		forceType ?? (raw.media_type === 'tv' || raw.first_air_date ? 'show' : 'movie');

	const title = raw.title ?? raw.name;
	if (!raw.id || !title) return null;

	const runtimeMin = raw.runtime ?? raw.episode_run_time?.[0];

	return {
		tmdbId: raw.id,
		type,
		title,
		originalTitle: raw.original_title ?? raw.original_name,
		year: yearOf(raw.release_date ?? raw.first_air_date),
		overview: raw.overview || undefined,
		poster: posterUrl(raw.poster_path),
		backdrop: backdropUrl(raw.backdrop_path),
		rating: raw.vote_average ? round1(raw.vote_average) : undefined,
		votes: raw.vote_count || undefined,
		genreIds: raw.genre_ids?.length ? raw.genre_ids : undefined,
		runtimeMin: runtimeMin || undefined,
		inLibrary: false // проставляется индексом
	};
}

function mapMovieCast(raw: RawDetails): Person[] {
	return (raw.credits?.cast ?? []).slice(0, 24).map((c) => ({
		id: c.id,
		name: c.name,
		character: c.character,
		photo: profileUrl(c.profile_path)
	}));
}

/**
 * Форма aggregate_credits другая: вместо character приезжает roles[] с
 * episode_count. Общий рендерер с фильмами тут не подходит.
 */
function mapAggregateCast(raw: RawDetails): Person[] {
	return (raw.aggregate_credits?.cast ?? []).slice(0, 24).map((c) => ({
		id: c.id,
		name: c.name,
		character:
			c.roles
				?.map((r) => r.character)
				.filter(Boolean)
				.join(', ') || undefined,
		episodeCount:
			c.roles?.reduce((sum, r) => sum + (r.episode_count ?? 0), 0) || c.total_episode_count,
		photo: profileUrl(c.profile_path)
	}));
}

/** Съёмочная группа по департаментам, важные — первыми. */
const CREW_ORDER = ['Directing', 'Writing', 'Production', 'Camera', 'Editing', 'Sound', 'Art'];

const DEPT_RU: Record<string, string> = {
	Directing: 'Режиссура',
	Writing: 'Сценарий',
	Production: 'Продюсирование',
	Camera: 'Операторская работа',
	Editing: 'Монтаж',
	Sound: 'Звук и музыка',
	Art: 'Художественная часть',
	'Costume & Make-Up': 'Костюмы и гримёры',
	'Visual Effects': 'Визуальные эффекты',
	Lighting: 'Свет',
	Crew: 'Прочая команда'
};

function mapCrew(raw: RawDetails, isMovie: boolean): CrewGroup[] {
	const source = isMovie ? raw.credits?.crew : raw.aggregate_credits?.crew;
	if (!source?.length) return [];

	const byDept = new Map<string, CrewGroup['people']>();
	for (const c of source) {
		const dept = c.department ?? 'Crew';
		const job = c.job ?? c.jobs?.map((j) => j.job).join(', ') ?? '';
		if (!job) continue;

		const list = byDept.get(dept) ?? [];
		// Один человек может висеть в департаменте несколько раз с разными
		// должностями — склеиваем, иначе список раздувается дублями.
		const existing = list.find((p) => p.id === c.id);
		if (existing) {
			if (!existing.job.includes(job)) existing.job += `, ${job}`;
		} else {
			list.push({ id: c.id, name: c.name, job, photo: profileUrl(c.profile_path) });
		}
		byDept.set(dept, list);
	}

	return [...byDept.entries()]
		.map(([department, people]) => ({
			department: DEPT_RU[department] ?? department,
			people: people.slice(0, 12),
			order: CREW_ORDER.indexOf(department)
		}))
		.sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order))
		.map(({ department, people }) => ({ department, people }));
}

function mapProviders(region?: RawProviderRegion): WatchOffers | undefined {
	if (!region) return undefined;

	const list = (arr?: RawProvider[]): WatchProvider[] =>
		(arr ?? [])
			.map((p) => ({
				id: p.provider_id,
				name: p.provider_name,
				logo: logoUrl(p.logo_path, 'w185'),
				priority: p.display_priority ?? 99
			}))
			.sort((a, b) => a.priority - b.priority);

	const offers: WatchOffers = {
		link: region.link,
		flatrate: list(region.flatrate),
		free: list(region.free),
		ads: list(region.ads),
		rent: list(region.rent),
		buy: list(region.buy)
	};

	const any =
		offers.flatrate.length +
		offers.free.length +
		offers.ads.length +
		offers.rent.length +
		offers.buy.length;
	return any ? offers : undefined;
}

function mapGallery(images?: RawDetails['images']): ImageGallery {
	const pick = (arr: TmdbImage[] | undefined, kind: 'backdrop' | 'poster', limit: number) =>
		(arr ?? [])
			.slice()
			.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
			.slice(0, limit)
			.map((i) => ({
				url: (kind === 'backdrop'
					? backdropUrl(i.file_path, 'w780')
					: posterUrl(i.file_path, 'w342'))!,
				// Через прокси — см. комментарий у фотографий персоны.
				full: proxiedOriginal(i.file_path)!
			}));

	return {
		backdrops: pick(images?.backdrops, 'backdrop', 12),
		posters: pick(images?.posters, 'poster', 12)
	};
}

function mapReviews(raw?: RawReview[]): Review[] {
	return (raw ?? []).slice(0, 6).map((r) => {
		const avatarPath = r.author_details?.avatar_path;
		return {
			author: r.author_details?.username || r.author,
			// TMDB иногда кладёт в avatar_path полный gravatar-URL с ведущим слэшем.
			avatar: avatarPath
				? avatarPath.startsWith('/http')
					? avatarPath.slice(1)
					: profileUrl(avatarPath)
				: undefined,
			rating: r.author_details?.rating ?? undefined,
			content: r.content,
			createdAt: r.created_at,
			url: r.url
		};
	});
}

function mapEpisodeStub(raw?: RawEpisodeStub | null) {
	if (!raw) return undefined;
	return {
		seasonNumber: raw.season_number,
		episodeNumber: raw.episode_number,
		name: raw.name,
		airDate: raw.air_date,
		still: stillUrl(raw.still_path)
	};
}

/** Только осмысленные варианты нумерации: абсолютная, DVD, сюжетные арки. */
function mapEpisodeGroups(raw?: RawEpisodeGroup[]): EpisodeGroup[] {
	return (raw ?? [])
		.filter((g) => g.episode_count > 0 && [2, 3, 5].includes(g.type))
		.slice(0, 4)
		.map((g) => ({
			id: g.id,
			name: g.name,
			groupCount: g.group_count,
			episodeCount: g.episode_count,
			type: g.type
		}));
}

/* --------------------------- сырые формы ответов --------------------------- */

interface RawProvider {
	provider_id: number;
	provider_name: string;
	logo_path?: string;
	display_priority?: number;
}

interface RawProviderRegion {
	link?: string;
	flatrate?: RawProvider[];
	free?: RawProvider[];
	ads?: RawProvider[];
	rent?: RawProvider[];
	buy?: RawProvider[];
}

interface RawReview {
	author: string;
	content: string;
	created_at?: string;
	url?: string;
	author_details?: { username?: string; avatar_path?: string | null; rating?: number | null };
}

interface RawEpisodeStub {
	season_number: number;
	episode_number: number;
	name: string;
	air_date?: string;
	still_path?: string | null;
}

interface RawEpisodeGroup {
	id: string;
	name: string;
	group_count: number;
	episode_count: number;
	type: number;
}

interface RawCastMember {
	id: number;
	name: string;
	character?: string;
	profile_path?: string | null;
	roles?: { character: string; episode_count?: number }[];
	total_episode_count?: number;
}

interface RawCrewMember {
	id: number;
	name: string;
	job?: string;
	jobs?: { job: string }[];
	department?: string;
	profile_path?: string | null;
}

interface RawDetails extends TmdbItem {
	tagline?: string;
	status?: string;
	budget?: number;
	revenue?: number;
	homepage?: string;
	original_language?: string;
	number_of_episodes?: number;
	production_countries?: { iso_3166_1: string; name: string }[];
	production_companies?: { id: number; name: string; logo_path?: string | null }[];
	networks?: { id: number; name: string; logo_path?: string | null }[];
	belongs_to_collection?: {
		id: number;
		name: string;
		poster_path?: string | null;
		backdrop_path?: string | null;
	} | null;
	credits?: { cast: RawCastMember[]; crew: RawCrewMember[] };
	aggregate_credits?: { cast: RawCastMember[]; crew: RawCrewMember[] };
	videos?: {
		results: { key: string; name?: string; site: string; type: string; official: boolean }[];
	};
	similar?: TmdbPage<TmdbItem>;
	recommendations?: TmdbPage<TmdbItem>;
	images?: { logos?: TmdbImage[]; backdrops?: TmdbImage[]; posters?: TmdbImage[] };
	keywords?: { keywords?: Keyword[]; results?: Keyword[] };
	translations?: { translations: TmdbTranslation[] };
	release_dates?: {
		results: {
			iso_3166_1: string;
			release_dates: { certification?: string; type?: number; release_date?: string }[];
		}[];
	};
	content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
	'watch/providers'?: { results: Record<string, RawProviderRegion> };
	external_ids?: { imdb_id?: string };
	reviews?: { results: RawReview[] };
	episode_groups?: { results: RawEpisodeGroup[] };
	next_episode_to_air?: RawEpisodeStub | null;
	last_episode_to_air?: RawEpisodeStub | null;
	seasons?: {
		season_number: number;
		name: string;
		episode_count: number;
		poster_path?: string | null;
		air_date?: string;
		overview?: string;
		vote_average?: number;
	}[];
}

interface RawCredit extends TmdbItem {
	character?: string;
	job?: string;
	department?: string;
}

interface RawPerson {
	id: number;
	name: string;
	biography?: string;
	birthday?: string | null;
	deathday?: string | null;
	place_of_birth?: string | null;
	known_for_department?: string;
	popularity?: number;
	profile_path?: string | null;
	combined_credits?: { cast: RawCredit[]; crew: RawCredit[] };
	images?: { profiles: TmdbImage[] };
	external_ids?: { imdb_id?: string };
	translations?: { translations: TmdbTranslation[] };
}

/* --------------------------------- справочники ----------------------------- */

/** Сети для фильтра на главной. */
export const NETWORKS = [
	{ id: 213, name: 'Netflix' },
	{ id: 1024, name: 'Prime Video' },
	{ id: 2739, name: 'Disney+' },
	{ id: 49, name: 'HBO' },
	{ id: 2552, name: 'Apple TV+' },
	{ id: 453, name: 'Hulu' },
	{ id: 4330, name: 'Paramount+' },
	{ id: 3353, name: 'Peacock' }
] as const;

/** Варианты сортировки каталога — человеческими словами. */
export const SORT_OPTIONS = [
	{ value: 'popularity.desc', label: 'Популярные' },
	{ value: 'vote_average.desc', label: 'Высокий рейтинг' },
	{ value: 'vote_count.desc', label: 'Больше всего оценок' },
	{ value: 'primary_release_date.desc', label: 'Сначала новые' },
	{ value: 'primary_release_date.asc', label: 'Сначала старые' },
	{ value: 'revenue.desc', label: 'Кассовые сборы' },
	{ value: 'title.asc', label: 'По алфавиту' }
] as const;

/** То же для сериалов: у TV другой набор ключей сортировки. */
export const SORT_OPTIONS_TV = [
	{ value: 'popularity.desc', label: 'Популярные' },
	{ value: 'vote_average.desc', label: 'Высокий рейтинг' },
	{ value: 'vote_count.desc', label: 'Больше всего оценок' },
	{ value: 'first_air_date.desc', label: 'Сначала новые' },
	{ value: 'first_air_date.asc', label: 'Сначала старые' },
	{ value: 'name.asc', label: 'По алфавиту' }
] as const;

/** Статусы сериала для фильтра. */
export const SHOW_STATUS = [
	{ value: 0, label: 'Продолжается' },
	{ value: 3, label: 'Завершён' },
	{ value: 4, label: 'Закрыт' },
	{ value: 2, label: 'В производстве' }
] as const;

export const COUNTRIES = [
	{ code: 'US', name: 'США' },
	{ code: 'RU', name: 'Россия' },
	{ code: 'GB', name: 'Великобритания' },
	{ code: 'FR', name: 'Франция' },
	{ code: 'DE', name: 'Германия' },
	{ code: 'IT', name: 'Италия' },
	{ code: 'ES', name: 'Испания' },
	{ code: 'JP', name: 'Япония' },
	{ code: 'KR', name: 'Южная Корея' },
	{ code: 'CN', name: 'Китай' },
	{ code: 'IN', name: 'Индия' },
	{ code: 'CA', name: 'Канада' },
	{ code: 'AU', name: 'Австралия' },
	{ code: 'SE', name: 'Швеция' },
	{ code: 'DK', name: 'Дания' },
	{ code: 'PL', name: 'Польша' }
] as const;
