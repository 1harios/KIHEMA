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

export const config = {
	demoMode: env.DEMO_MODE === 'true' || !(env.TMDB_API_KEY || env.TMDB_READ_TOKEN),

	tmdb: {
		apiKey: env.TMDB_API_KEY ?? '',
		/**
		 * v4 Read Access Token. Если задан — используется вместо api_key: один
		 * креденшл работает и в v3, и в v4, и уходит заголовком, а не в URL.
		 */
		readToken: env.TMDB_READ_TOKEN ?? '',
		language: env.TMDB_LANGUAGE ?? 'ru-RU',
		region: env.TMDB_REGION ?? 'RU'
	},

	jellyfin: {
		baseUrl: (env.JELLYFIN_URL ?? '').replace(/\/+$/, ''),
		clientName: env.JELLYFIN_CLIENT_NAME ?? 'Kinema',
		version: '0.1.0',
		apiKey: env.JELLYFIN_API_KEY ?? ''
	},

	sessionSecret: env.SESSION_SECRET ?? 'dev-insecure-secret',
	indexPath: env.INDEX_PATH ?? 'data/index.json',
	/** Как часто пересобирать индекс библиотеки, в минутах. */
	indexRefreshMinutes: Number.parseInt(env.INDEX_REFRESH_MINUTES ?? '60', 10),

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
		apiUrl: env.SCRAPER_API_URL ?? 'https://lightstream.ws/api/scrape',
		// Upstream отдаёт потоки только «своему» источнику — шлём Origin.
		apiOrigin: env.SCRAPER_API_ORIGIN ?? 'https://lightstream.ws',
		/** Источники через запятую; порядок = приоритет. */
		sources: (env.SCRAPER_SOURCES ?? 'cobalt,titan,carbon').split(',').map((s) => s.trim())
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
