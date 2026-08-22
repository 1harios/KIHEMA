import { error, json, type RequestHandler } from '@sveltejs/kit';
import { archivePlaybackSource, findArchiveFilm } from '$lib/server/archive';
import { config as siteConfig, jellyfinAnon, libraryIndex } from '$lib/server/config';
import { DEMO_SEGMENTS, DEMO_STREAMS, DEMO_TRANSLATIONS } from '$lib/server/demo-data';
import { getIntroDbSegments, mergeMediaSegments } from '$lib/server/introdb';
import { readSession } from '$lib/server/session';
import { scrapePlaybackSource, type ScrapeResult } from '$lib/server/sources/lightstream';
import { torrentPlaybackSource } from '$lib/server/sources/torrserver';
import type { MediaType, PlaybackProvider, PlaybackSource } from '$lib/types';

/**
 * Разрешает тайтл в готовый к воспроизведению источник.
 *
 * Порядок источников: демо → архив (открытый контент) → собственная медиатека
 * Jellyfin (если тайтл в индексе и пользователь вошёл) → CDN-скраперы
 * (Cobalt/Titan/Carbon, без логина) → локальный TorrServer (торренты, только
 * при TORRSERVER_ENABLED=true). Скраперы стоят перед торрентами: готовый
 * CDN-поток стартует мгновенно, а раздаче нужно время на сиды и метаданные.
 *
 * О токене: медиа-URL (HLS-сегменты, субтитры, тайлы) уходят в браузер с api_key
 * в query — заголовок туда не поставить. Это тот же подход, что в штатном
 * jellyfin-web. Токен пользовательский и скоупится его правами.
 */

/** Скрейпим параллельно с Jellyfin-путём, когда оба могут дать результат. */
async function tryScrape(
	type: MediaType,
	tmdbId: number,
	season?: number,
	episode?: number
): Promise<ScrapeResult> {
	if (!siteConfig.scrapers.enabled) return { source: null, reason: 'upstream' };
	const result = await scrapePlaybackSource({ type, tmdbId, season, episode });
	return result.source ? { ...result, source: { ...result.source, provider: 'scrapers' } } : result;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json()) as {
		type: MediaType;
		tmdbId: number;
		season?: number;
		episode?: number;
		audioStreamIndex?: number;
		subtitleStreamIndex?: number;
		startPositionSec?: number;
		/** Источники, которые уже доказанно не сработали — плеер просит их пропустить. */
		exclude?: PlaybackProvider[];
		/** infoHash раздачи, выбранной пользователем в плеере, — идём сразу в торренты. */
		torrent?: string;
	};

	if (!body?.tmdbId || !body?.type) error(400, 'Не переданы type и tmdbId');
	if (body.type === 'show' && (body.season == null || body.episode == null)) {
		error(400, 'Для сериала нужны season и episode');
	}
	const excluded = new Set(body.exclude ?? []);

	/* ------------------------------ демо-режим ------------------------------ */
	if (siteConfig.demoMode) {
		const active =
			DEMO_TRANSLATIONS.find((t) => t.audioStreamIndex === body.audioStreamIndex) ??
			DEMO_TRANSLATIONS[0];

		const source: PlaybackSource = {
			jellyfinItemId: `demo-${body.tmdbId}`,
			mediaSourceId: 'demo',
			playSessionId: 'demo-session',
			streamUrl: DEMO_STREAMS[0],
			playMethod: 'Transcode',
			durationSec: 0, // возьмём из метаданных самого потока
			startPositionSec: body.startPositionSec ?? 0,
			translations: DEMO_TRANSLATIONS,
			activeTranslationId: active.id,
			subtitles: [],
			segments: DEMO_SEGMENTS
		};
		return json(source);
	}

	// Запускаем запрос одновременно с поиском потока, чтобы таймкоды почти не
	// увеличивали время открытия плеера. Сбой TheIntroDB не отменяет просмотр.
	const introSegmentsPromise = getIntroDbSegments({
		type: body.type,
		tmdbId: body.tmdbId,
		season: body.season,
		episode: body.episode
	});
	const withIntroSegments = async (source: PlaybackSource): Promise<PlaybackSource> => ({
		...source,
		segments: mergeMediaSegments(source.segments, await introSegmentsPromise)
	});

	/* --------------------------- Internet Archive --------------------------- */
	// Проверяем до Jellyfin и до проверки сессии: это открытый контент,
	// логин для него не нужен.
	if (body.type === 'movie') {
		const film = findArchiveFilm(body.tmdbId);
		if (film) {
			return json(
				await withIntroSegments({ ...archivePlaybackSource(film), provider: 'archive' })
			);
		}
	}

	/* ------------------------- собственная медиатека ------------------------ */
	const session = readSession(cookies);
	let itemId: string | undefined;

	if (body.type === 'movie') {
		itemId = libraryIndex.findMovie(body.tmdbId)?.jellyfinId;
	} else if (body.season != null && body.episode != null) {
		itemId = libraryIndex.findEpisode(body.tmdbId, body.season, body.episode)?.jellyfinId;
	}

	if (session && jellyfinAnon && itemId) {
		const client = jellyfinAnon.withToken(session.jellyfinToken, session.deviceId);
		try {
			const source = await client.getPlaybackSource({
				itemId,
				userId: session.userId,
				audioStreamIndex: body.audioStreamIndex,
				subtitleStreamIndex: body.subtitleStreamIndex,
				startPositionSec: body.startPositionSec,
				mediaToken: session.jellyfinToken
			});
			return json(await withIntroSegments({ ...source, provider: 'jellyfin' }));
		} catch (e) {
			// Jellyfin моргнул — ниже попробуем CDN, это лучше, чем обломиться.
			console.error(
				'[playback] Jellyfin не отдал поток, пробуем CDN:',
				e instanceof Error ? e.message : e
			);
		}
	}

	/* ------------------------- явный выбор раздачи --------------------------- */
	// Пользователь выбрал конкретную раздачу в плеере (смена качества/озвучки):
	// CDN и Jellyfin пропускаем — запрос явно про торрент.
	if (body.torrent && siteConfig.torrents.enabled && !excluded.has('torrent')) {
		try {
			const torrent = await torrentPlaybackSource(
				{ type: body.type, tmdbId: body.tmdbId, season: body.season, episode: body.episode },
				{ hash: body.torrent }
			);
			if (torrent) {
				return json(await withIntroSegments({ ...torrent, provider: 'torrent' }));
			}
		} catch (e) {
			console.error(
				'[playback] выбранная раздача не завелась:',
				e instanceof Error ? e.message : e
			);
		}
		error(404, 'Выбранная раздача не запустилась — попробуйте другую');
	}

	/* ------------------------------ CDN-скраперы ----------------------------- */
	const scraped = excluded.has('scrapers')
		? ({ source: null, reason: 'not_found' } as ScrapeResult)
		: await tryScrape(body.type, body.tmdbId, body.season, body.episode);
	if (scraped.source) return json(await withIntroSegments(scraped.source));

	/* ------------------------------- торренты -------------------------------- */
	// Запасной путь: тайтла нет в играбельных CDN — пробуем TorrServer на VPS.
	// Включён по умолчанию (TORRSERVER_ENABLED !== 'false'), сервер cloudflared tunnel к VPS.
	if (siteConfig.torrents.enabled && !excluded.has('torrent')) {
		try {
			console.log('[playback] пробую торрент-источник для', body.type, body.tmdbId);
			const torrent = await torrentPlaybackSource({
				type: body.type,
				tmdbId: body.tmdbId,
				season: body.season,
				episode: body.episode
			});
			if (torrent) {
				return json(await withIntroSegments({ ...torrent, provider: 'torrent' }));
			}
		} catch (e) {
			console.error(
				'[playback] торрент-источник не сработал:',
				e instanceof Error ? e.message : e
			);
		}
	} else {
		console.warn('[playback] торренты', siteConfig.torrents.enabled ? 'выключены по config' : 'исключены');
	}

	/* ----------------------------- понятные ошибки --------------------------- */
	if (itemId && !session && jellyfinAnon) error(401, 'Нужно войти');
	if (itemId && !jellyfinAnon) error(503, 'Jellyfin не настроен');
	// Временный сбой CDN не должен маскироваться под «тайтла нет». Иначе
	// PlayerController получает 404, считает отказ окончательным и не запускает
	// свой автоматический повтор. Это особенно проявлялось там, где Jellyfin
	// настроен, но запрошенного тайтла в личной библиотеке нет.
	if (scraped.reason === 'upstream') {
		error(502, 'CDN-источники временно не ответили, попробуйте ещё раз');
	}
	if (scraped.reason === 'not_found') {
		error(
			404,
			'Этого тайтла нет в CDN-источниках, играбельных прямо в браузере. Такие закрытые источники, как Titan, не разрешают прямое воспроизведение. Попробуйте другой тайтл или другую серию.'
		);
	}
	error(404, 'Тайтла нет в медиатеке, и CDN-источники его не нашли');
};

// Vercel default timeout 10s, но torrenents требуют до 60 сек — используем serverless runtime
export const config = { 
	maxDuration: 60,
	runtime: 'nodejs' // Не edge, так как нужны обычные fetch
	// maxDuration работает через Vercel timeout, но функция завершается раньше из-за сети
};
