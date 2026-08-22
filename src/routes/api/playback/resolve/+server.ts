import { error, json, type RequestHandler } from '@sveltejs/kit';
import { archivePlaybackSource, findArchiveFilm } from '$lib/server/archive';
import { config as siteConfig, jellyfinAnon, libraryIndex } from '$lib/server/config';
import { DEMO_SEGMENTS, DEMO_STREAMS, DEMO_TRANSLATIONS } from '$lib/server/demo-data';
import { getIntroDbSegments, mergeMediaSegments } from '$lib/server/introdb';
import { readSession } from '$lib/server/session';
import { torrentPlaybackSource } from '$lib/server/sources/torrserver';
import type { MediaType, PlaybackProvider, PlaybackSource } from '$lib/types';

/**
 * Разрешает тайтл в готовый к воспроизведению источник.
 *
 * Порядок источников: демо → архив (открытый контент) → собственная медиатека
 * Jellyfin (если тайтл в индексе и пользователь вошёл) → локальный TorrServer
 * (торренты, при TORRSERVER_ENABLED=true). Торрент-источник основной — все
 * потоки транслируются через cloudflared tunnel от TorrServer MatriX.143.
 *
 * О токене: медиа-URL (HLS-сегменты, субтитры, тайлы) уходят в браузер с api_key
 * в query — заголовок туда не поставить. Это тот же подход, что в штатном
 * jellyfin-web. Токен пользовательский и скоупится его правами.
 */


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
			// Jellyfin моргнул — пробуем торрент.
			console.error(
				'[playback] Jellyfin не отдал поток, пробуем торрент:',
				e instanceof Error ? e.message : e
			);
		}
	}

	/* ------------------------- явный выбор раздачи --------------------------- */
	// Пользователь выбрал конкретную раздачу в плеере (смена качества/озвучки):
	// Jellyfin пропускаем — запрос явно про торрент.
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

	/* ------------------------------- торренты -------------------------------- */
	// Torrenents основной источник — торренты транслируются через TorrServer
	// MatriX.143 с cloudflared tunnel.
	if (siteConfig.torrents.enabled && !excluded.has('torrent')) {
		try {
			console.log('[playback] пробуем торрент-источник для', body.type, body.tmdbId);
			
			const searchPromise = (async () => {
				console.log(`[playback] torrenents: start search ${body.season ? `S${body.season}E${body.episode}` : 'movie'}`);
				
				// Запускаем поиск с подробным логированием каждого шага
				const result = await Promise.race([
					torrentPlaybackSource({
						type: body.type,
						tmdbId: body.tmdbId,
						season: body.season,
						episode: body.episode
					}).then(source => {
						if (!source) {
							console.warn(`[playback] torrenents: no source found for tmdb ${body.tmdbId}`);
						} else {
							console.log(`[playback] torrenents: SUCCESS - ${source.streamUrl.substring(0, 50)}...`);
						}
						return source;
					}),
					new Promise<null>((_, reject) => 
						setTimeout(() => reject(new Error('[playback] torrenents timeout after 120s')), 120_000)
					)
				]);
				
				return result;
			})();
			
			const torrent = await searchPromise;
			if (torrent) {
				return json(await withIntroSegments({ ...torrent, provider: 'torrent' }));
			}
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			const isFetchError = /fetch/i.test(errorMsg);
			
			if (isFetchError) {
				console.error('[playback] TorrServer недоступен по URL:', config.torrents.serverUrl);
				console.error('[playback] Ошибка подключения:', errorMsg);
				console.error('[playback] Проверьте:');
				console.error('1. TorrServer запущен?');
				console.error('2. Cloudflared tunnel доступен из интернета?');
				console.error('3. Firewall блокирует HTTPS?');
			} else {
				console.error('[playback] torrenents error or timeout:', errorMsg);
			}
		}
	} else {
		console.warn('[playback] торренты', siteConfig.torrents.enabled ? 'выключены по config' : 'исключены');
	}

	/* ----------------------------- понятные ошибки --------------------------- */
	if (itemId && !session && jellyfinAnon) error(401, 'Нужно войти');
	if (itemId && !jellyfinAnon) error(503, 'Jellyfin не настроен');
	error(404, 'Тайтл не найден в медиатеке или торрент-источнике');
};

// Увеличиваем timeout для Vercel — торренты требуют до 60 сек на старт нового контента
export const config = { 
	maxDuration: 300, // 5 минут максимум (торренты могут долго стартовать)
	runtime: 'nodejs20.x'
};
