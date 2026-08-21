/**
 * Внутренняя модель приложения.
 *
 * Namespace-и TMDB и Jellyfin наружу не торчат: UI работает только с этими типами.
 * Названия в блоке воспроизведения сознательно повторяют модель LightStream
 * (translations / subtitles), потому что она хорошо ложится на то, что отдаёт
 * Jellyfin.
 */

export type MediaType = 'movie' | 'show';

export const TICKS_PER_SECOND = 10_000_000;

export const ticksToSeconds = (ticks: number | null | undefined): number =>
	ticks == null ? 0 : ticks / TICKS_PER_SECOND;

export const secondsToTicks = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

/** Карточка в каталоге. Источник метаданных — TMDB, `inLibrary` — Jellyfin. */
export interface CatalogItem {
	tmdbId: number;
	type: MediaType;
	title: string;
	originalTitle?: string;
	year?: number;
	overview?: string;
	poster?: string;
	backdrop?: string;
	logo?: string;
	rating?: number;
	/** Число голосов. Без него рейтинг 10.0 по двум голосам выглядит правдой. */
	votes?: number;
	genres?: string[];
	/**
	 * Идентификаторы жанров как их отдаёт TMDB в списках. Названий там нет —
	 * только числа, поэтому имена подставляются отдельно по справочнику (см.
	 * tmdb.withGenreNames). Оставлены в модели, потому что по ним же выбирается
	 * иконка жанра на карточке.
	 */
	genreIds?: number[];
	/** Длительность фильма или средняя серии, минуты. */
	runtimeMin?: number;
	/** Возрастной рейтинг для региона: 0+, 6+, 12+, 16+, 18+. */
	ageRating?: string;
	/** Есть ли тайтл в медиатеке. Определяет, показывать ли кнопку «Смотреть». */
	inLibrary: boolean;
	jellyfinId?: string;
}

export interface Person {
	id?: number;
	name: string;
	character?: string;
	photo?: string;
	/** Сколько серий сериала с этим актёром — из aggregate_credits. */
	episodeCount?: number;
}

/** Съёмочная группа, сгруппированная по департаменту. */
export interface CrewGroup {
	department: string;
	people: { id?: number; name: string; job: string; photo?: string }[];
}

export interface SeasonSummary {
	seasonNumber: number;
	name: string;
	episodeCount: number;
	poster?: string;
	airDate?: string;
	overview?: string;
	rating?: number;
	/** Сколько серий этого сезона реально лежит в медиатеке. */
	inLibraryCount: number;
}

export interface EpisodeSummary {
	seasonNumber: number;
	episodeNumber: number;
	name: string;
	overview?: string;
	still?: string;
	runtimeSec?: number;
	airDate?: string;
	rating?: number;
	inLibrary: boolean;
	jellyfinId?: string;
	/** Прогресс просмотра 0..1, если серия начата. */
	progress?: number;
	watched?: boolean;
}

/* ---------------------------------------------------------------------- */
/* Обвязка карточки тайтла                                                */
/* ---------------------------------------------------------------------- */

/** Где посмотреть легально — данные JustWatch через TMDB. */
export interface WatchProvider {
	id: number;
	name: string;
	logo?: string;
	priority: number;
}

export interface WatchOffers {
	/** Ссылка на страницу выбора на TMDB — прямых deep-link API не отдаёт. */
	link?: string;
	flatrate: WatchProvider[];
	free: WatchProvider[];
	ads: WatchProvider[];
	rent: WatchProvider[];
	buy: WatchProvider[];
}

export interface Keyword {
	id: number;
	name: string;
}

/** Франшиза: «Дюна», «Матрица». Из movie.belongs_to_collection. */
export interface CollectionRef {
	id: number;
	name: string;
	poster?: string;
	backdrop?: string;
}

export interface CollectionDetails extends CollectionRef {
	overview?: string;
	parts: CatalogItem[];
}

/** Производственные факты: то, что показывают справкой, а не в описании. */
export interface ProductionFacts {
	status?: string;
	budget?: number;
	revenue?: number;
	originalLanguage?: string;
	companies: { id: number; name: string; logo?: string }[];
	networks: { id: number; name: string; logo?: string }[];
	/** Раздельные даты релиза для региона: кино и цифра. */
	theatricalDate?: string;
	digitalDate?: string;
}

export interface ImageGallery {
	backdrops: { url: string; full: string }[];
	posters: { url: string; full: string }[];
}

export interface Review {
	author: string;
	avatar?: string;
	rating?: number;
	content: string;
	createdAt?: string;
	url?: string;
}

/** Ближайшая серия — для обратного отсчёта на странице сериала. */
export interface EpisodeStub {
	seasonNumber: number;
	episodeNumber: number;
	name: string;
	airDate?: string;
	still?: string;
}

/** Вариант нумерации серий: абсолютная, DVD, сюжетные арки. Для аниме. */
export interface EpisodeGroup {
	id: string;
	name: string;
	groupCount: number;
	episodeCount: number;
	type: number;
}

export interface TitleDetails extends CatalogItem {
	tagline?: string;
	runtimeSec?: number;
	countries?: string[];
	genreRefs: { id: number; name: string }[];
	cast: Person[];
	crew: CrewGroup[];
	trailerKey?: string;
	videos: { key: string; name: string; type: string }[];
	seasons: SeasonSummary[];
	similar: CatalogItem[];
	recommendations: CatalogItem[];
	keywords: Keyword[];
	providers?: WatchOffers;
	facts: ProductionFacts;
	gallery: ImageGallery;
	reviews: Review[];
	collection?: CollectionRef;
	nextEpisode?: EpisodeStub;
	lastEpisode?: EpisodeStub;
	episodeGroups: EpisodeGroup[];
	imdbId?: string;
	homepage?: string;
	/** Всего серий у сериала. */
	totalEpisodes?: number;
}

/* ---------------------------------------------------------------------- */
/* Персона                                                                */
/* ---------------------------------------------------------------------- */

export interface PersonCredit extends CatalogItem {
	character?: string;
	job?: string;
	department?: string;
}

export interface PersonDetails {
	id: number;
	name: string;
	photo?: string;
	biography?: string;
	birthday?: string;
	deathday?: string;
	placeOfBirth?: string;
	knownFor?: string;
	popularity?: number;
	imdbId?: string;
	/** Актёрские работы, отсортированы по году убыв. */
	acting: PersonCredit[];
	/** Работы в команде: режиссура, сценарий и прочее. */
	crew: PersonCredit[];
	photos: { url: string; full: string }[];
}

/* ---------------------------------------------------------------------- */
/* Подбор и фильтры                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Полный набор фильтров Discover. Раньше использовалось четыре параметра из
 * сорока доступных — отсюда и «фильтры как у всех».
 */
export interface DiscoverFilters {
	genres?: number[];
	excludeGenres?: number[];
	/** AND — «и то, и то». Иначе OR. Разница в выдаче огромная. */
	genresMatchAll?: boolean;
	keywords?: number[];
	excludeKeywords?: number[];
	yearFrom?: number;
	yearTo?: number;
	runtimeFrom?: number;
	runtimeTo?: number;
	minRating?: number;
	maxRating?: number;
	/** Порог голосов. Без него сортировка по рейтингу возвращает мусор. */
	minVotes?: number;
	country?: string;
	language?: string;
	people?: number[];
	companies?: number[];
	networks?: number[];
	providers?: number[];
	monetization?: string[];
	showStatus?: number[];
	sortBy?: string;
	page?: number;
	onlyLibrary?: boolean;
}

export interface DiscoverResult {
	items: CatalogItem[];
	totalPages: number;
	totalResults: number;
}

/** Пресет настроения для подбора — набор ключевых слов TMDB. */
export interface MoodPreset {
	id: string;
	label: string;
	hint: string;
	/** ID ключевых слов TMDB. Точнее жанров: «временная петля» vs «фантастика». */
	keywords: number[];
	genres?: number[];
	excludeGenres?: number[];
}

/* ---------------------------------------------------------------------- */
/* Воспроизведение                                                         */
/* ---------------------------------------------------------------------- */

/**
 * «Озвучка» = одна аудиодорожка Jellyfin.
 *
 * ВАЖНО: Jellyfin отдаёт HLS-манифест ровно с одной аудиодорожкой. Переключение
 * озвучки — это НЕ выбор дорожки внутри плеера, а перезапрос манифеста с другим
 * audioStreamIndex и возврат на текущую позицию. См. player/controller.ts.
 */
export interface Translation {
	/** Стабильный id для URL и сохранения выбора. */
	id: string;
	/** Абсолютный Index потока в контейнере — именно он идёт в AudioStreamIndex. */
	audioStreamIndex: number;
	/** Готовая подпись для списка: «Дубляж · AC3 · 5.1». */
	label: string;
	language?: string;
	codec?: string;
	channels?: number;
	isDefault: boolean;
	/**
	 * Готовый манифест этой озвучки — только у CDN-источников (Cobalt/Titan/
	 * Carbon), где каждая дорожка лежит отдельным файлом. Если он есть, плеер
	 * переключается без перезапроса сервера. Для Jellyfin поле не задано.
	 */
	url?: string;
	/** Тип манифеста для url выше; по умолчанию считается HLS. */
	manifest?: 'hls' | 'dash';
}

export interface SubtitleTrack {
	id: string;
	subtitleStreamIndex: number;
	label: string;
	language?: string;
	isForced: boolean;
	isHearingImpaired: boolean;
	/** Готовый URL на VTT через наш прокси. */
	url: string;
}

/** Превью кадров на таймлайне (нативный Trickplay Jellyfin 10.9+). */
export interface TrickplayInfo {
	width: number;
	height: number;
	tileWidth: number;
	tileHeight: number;
	intervalMs: number;
	thumbnailCount: number;
	/** Шаблон URL тайла, `{index}` подставляется на клиенте. */
	tileUrlTemplate: string;
}

/** Заставка и титры — для кнопок «Пропустить». */
export interface MediaSegment {
	type: 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial' | 'Unknown';
	startSec: number;
	endSec: number;
}

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

/** Откуда приехал поток — плееру нужно, чтобы понимать смысл полей. */
export type PlaybackProvider = 'jellyfin' | 'archive' | 'scrapers' | 'torrent';

export interface PlaybackSource {
	jellyfinItemId: string;
	mediaSourceId: string;
	playSessionId: string;
	/** HLS-манифест или прямой файл — зависит от playMethod. */
	streamUrl: string;
	playMethod: PlayMethod;
	durationSec: number;
	/** Позиция для возобновления, из UserData Jellyfin. */
	startPositionSec: number;
	translations: Translation[];
	activeTranslationId: string;
	subtitles: SubtitleTrack[];
	trickplay?: TrickplayInfo;
	segments: MediaSegment[];
	/** Не задано только у старых источников — считаем jellyfin. */
	provider?: PlaybackProvider;
}

export interface PlaybackContext {
	title: string;
	originalTitle?: string;
	type: MediaType;
	tmdbId: number;
	seasonNumber?: number;
	episodeNumber?: number;
	episodeTitle?: string;
	/** Следующая серия, если есть — для автоперехода и кнопки «Далее». */
	nextEpisode?: { seasonNumber: number; episodeNumber: number; name: string };
}

/* ---------------------------------------------------------------------- */
/* Пользователь и оформление                                              */
/* ---------------------------------------------------------------------- */

export interface SessionUser {
	id: string;
	name: string;
	isAdmin: boolean;
}

/**
 * Ключи тем не меняются с прошлой версии намеренно: в app.html они прибиты в
 * bootstrap-скрипте и лежат в cookie у существующих пользователей. Изменился
 * только смысл значений — теперь это подтон холста, а не цветная тема.
 */
export const THEMES = ['default', 'frost', 'blue', 'teal', 'red', 'gray'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
	default: 'Платина',
	frost: 'Иней',
	blue: 'Ночная',
	teal: 'Изумруд',
	red: 'Гранат',
	gray: 'Графит'
};

/** Кружки в переключателе тем — акцент самой темы. */
export const THEME_SWATCH: Record<Theme, string> = {
	default: '#dde3ed',
	frost: '#d5e7f2',
	blue: '#cfd9f5',
	teal: '#cfe9df',
	red: '#f0d8dc',
	gray: '#ededed'
};

/* ---------------------------------------------------------------------- */
/* Личные списки (localStorage, без сервера)                              */
/* ---------------------------------------------------------------------- */

export const LIST_KINDS = ['later', 'favorite'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export const LIST_LABELS: Record<ListKind, string> = {
	later: 'Смотреть позже',
	favorite: 'Избранное'
};

/** Запись личного списка. Храним снимок карточки, чтобы не ходить в API. */
export interface ListEntry {
	tmdbId: number;
	type: MediaType;
	title: string;
	poster?: string;
	year?: number;
	rating?: number;
	addedAt: number;
}
