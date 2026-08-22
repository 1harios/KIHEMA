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

	/* --------------------- торренты: Jackett + TorrServer -------------------- */
	/*
	 * Основной источник воспроизведения. Поиск раздач идёт через Jackett и Torrentio,
	 * раздачи транслируются через TorrServer MatriX.143 с cloudflared tunnel в HLS.
	 * Включается переменной TORRSERVER_ENABLED=false для отключения.
	 */
	torrents: {
		enabled: env.TORRSERVER_ENABLED !== 'false', // по умолчанию true на Vercel
		serverUrl: envOr(env.TORRSERVER_URL, 'https://integer-mysql-helicopter-brother.trycloudflare.com').replace(/\/+$/, ''),
		jackettUrl: envOr(env.JACKETT_URL, 'https://jac.red').replace(/\/+$/, ''),
		jackettApiKey: (env.JACKETT_API_KEY ?? '').trim(),
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
