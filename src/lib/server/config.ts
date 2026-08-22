/**
 * Конфигурация и общие синглтоны сервера.
 *
 * Всё читается из окружения один раз при старте. Если DEMO_MODE=true, приложение
 * поднимается без Jellyfin и TMDB на встроенном наборе данных — удобно смотреть
 * вёрстку и отдавать демо, не поднимая инфраструктуру.
 */

import { env } from '$env/dynamic/private';
import { JellyfinClient } from './jellyfin';
import { LibraryIndex } from './library-index';
import { TmdbClient } from './tmdb';

/**
 * Значение переменной или дефолт. Именно ИЛИ, а не ??: панели хостингов
 * (Vercel в том числе) отдают заведённую, но не заполненную переменную пустой
 * строкой, а не undefined. С ?? такая переменная переживает дефолт, и пустой
 * language='' уходит в TMDB — тот молча отвечает по-английски. Каталог
 * оказывается английским при русском интерфейсе, и виноватым выглядит токен.
 */
const envOr = (value: string | undefined, fallback: string) => value?.trim() || fallback;

export const config = {
	demoMode: env.DEMO_MODE === 'true' || !(env.TMDB_API_KEY?.trim() || env.TMDB_READ_TOKEN?.trim()),

	tmdb: {
		apiKey: (env.TMDB_API_KEY ?? '').trim(),
		/**
		 * v4 Read Access Token. Если задан — используется вместо api_key: один
		 * креденшл работает и в v3, и в v4, и уходит заголовком, а не в URL.
		 */
		readToken: (env.TMDB_READ_TOKEN ?? '').trim(),
		language: envOr(env.TMDB_LANGUAGE, 'ru-RU'),
		region: envOr(env.TMDB_REGION, 'RU')
	},

	jellyfin: {
		// trim до проверки: случайный пробел в переменной иначе делает
		// isJellyfinConfigured() истинным при нерабочем адресе.
		baseUrl: (env.JELLYFIN_URL ?? '').trim().replace(/\/+$/, ''),
		clientName: envOr(env.JELLYFIN_CLIENT_NAME, 'Kinema'),
		version: '0.1.0',
		apiKey: (env.JELLYFIN_API_KEY ?? '').trim()
	},

	sessionSecret: envOr(env.SESSION_SECRET, 'dev-insecure-secret'),
	indexPath: envOr(env.INDEX_PATH, 'data/index.json'),
	/** Как часто пересобирать индекс библиотеки, в минутах. */
	indexRefreshMinutes: Number.parseInt(envOr(env.INDEX_REFRESH_MINUTES, '60'), 10),

	/* ----------------------- заставки и титры TheIntroDB ---------------------- */
	introDb: {
		// Публичные таймкоды доступны без ключа; интеграцию можно отключить явно.
		enabled: env.INTRODB_ENABLED !== 'false',
		baseUrl: envOr(env.INTRODB_API_URL, 'https://api.theintrodb.org'),
		apiKey: (env.INTRODB_API_KEY ?? '').trim()
	},

	/* ------------------------------ CDN-скраперы ----------------------------- */
	/*
	 * Внешний резолвер потоков по TMDB ID (источники cobalt / titan / carbon).
	 *
	 * ВЫКЛЮЧЕН ПО УМОЛЧАНИЮ. Раньше было наоборот, но вместе с удалением
	 * прокси /api/hls это стало бы обманом интерфейса: withPresence() помечает
	 * доступным ВСЁ, когда скраперы включены, а источники, требующие подмены
	 * Origin, теперь не играются. Каталог обещал бы просмотр, который срывается.
	 *
	 * Штатные источники воспроизведения — Jellyfin (своя медиатека) и Internet
	 * Archive (общественное достояние). Включить обратно: SCRAPERS_ENABLED=true.
	 */
	scrapers: {
		enabled: env.SCRAPERS_ENABLED === 'true',
		apiUrl: envOr(env.SCRAPER_API_URL, 'https://lightstream.ws/api/scrape'),
		// Upstream отдаёт потоки только «своему» источнику — шлём Origin.
		apiOrigin: envOr(env.SCRAPER_API_ORIGIN, 'https://lightstream.ws'),
		/**
		 * Источники через запятую; порядок = приоритет.
		 * Carbon первым: его CDN (interkh.com) отдаёт манифесты и сегменты с
		 * Access-Control-Allow-Origin для любого источника — играется в браузере
		 * напрямую. Titan (obrut.show) разрешает только Origin lightstream.ws и
		 * в браузере даёт 403, поэтому он запасной.
		 */
		sources: envOr(env.SCRAPER_SOURCES, 'carbon,titan,cobalt')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	},

	/* --------------------- торренты: Jackett + TorrServer -------------------- */
	/*
	 * Запасной источник, когда в CDN тайтла нет (например, только Origin-locked
	 * Titan). Поиск раздач идёт через Jackett-совместимый API по названию из
	 * TMDB, раздача добавляется в ЛОКАЛЬНЫЙ TorrServer (gst-сборка), который на
	 * лету транскодирует любой контейнер в H.264/AAC HLS с открытым CORS.
	 *
	 * Только для локального запуска: браузер обращается к 127.0.0.1 напрямую,
	 * поэтому на Vercel источник не поднимется. Включается переменной
	 * TORRSERVER_ENABLED=true; без неё (и при недоступном сервере) цепочка
	 * разрешения проходит мимо, ничего не ломая.
	 */
	torrents: {
		enabled: env.TORRSERVER_ENABLED !== 'false', // по умолчанию true на Vercel
		serverUrl: envOr(env.TORRSERVER_URL, 'https://integer-mysql-helicopter-brother.trycloudflare.com').replace(/\/+$/, ''),
		jackettUrl: envOr(env.JACKETT_URL, 'https://jac.red').replace(/\/+$/, ''),
		jackettApiKey: (env.JACKETT_API_KEY ?? '').trim(),
		/**
		 * Torrentio — публичный Stremio-аддон: раздач по IMDb ID больше, чем у
		 * Jackett, и приходят они со счётчиком сидов. Отключить: TORRENTIO_ENABLED=false.
		 */
		torrentioUrl: envOr(env.TORRENTIO_URL, 'https://torrentio.strem.fun').replace(/\/+$/, ''),
		torrentioEnabled: env.TORRENTIO_ENABLED !== 'false'
	}
} as const;

export const isJellyfinConfigured = (): boolean => Boolean(config.jellyfin.baseUrl);

/* ------------------------------- синглтоны -------------------------------- */

export const libraryIndex = new LibraryIndex(config.indexPath);

export const tmdb =
	config.tmdb.apiKey || config.tmdb.readToken
		? new TmdbClient(
				config.tmdb.apiKey,
				config.tmdb.language,
				config.tmdb.region,
				config.tmdb.readToken
			)
		: null;

/** Клиент без пользовательского токена — для логина и фоновых задач. */
export const jellyfinAnon = isJellyfinConfigured()
	? new JellyfinClient({
			baseUrl: config.jellyfin.baseUrl,
			clientName: config.jellyfin.clientName,
			version: config.jellyfin.version
		})
	: null;

/** Клиент с админским ключом — только для сборки индекса. */
export const jellyfinAdmin =
	isJellyfinConfigured() && config.jellyfin.apiKey
		? new JellyfinClient(
				{
					baseUrl: config.jellyfin.baseUrl,
					clientName: config.jellyfin.clientName,
					version: config.jellyfin.version
				},
				config.jellyfin.apiKey,
				'kinema-indexer',
				'Kinema Indexer'
			)
		: null;
