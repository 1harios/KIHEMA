/**
 * CDN-скраперы (источники Cobalt / Titan / Carbon).
 *
 * Третий адаптер источника рядом с Jellyfin и Internet Archive. Отдаёт потоки
 * по TMDB ID: фильмы и конкретные серии. Каждый источник возвращает несколько
 * «озвучек», у каждой — собственный манифест, поэтому смена озвучки здесь
 * НЕ перезапрашивает сервер: все URL приезжают сразу одним ответом, а плеер
 * переподключается на лету (см. Translation.url в player/controller).
 *
 * ВАЖНО ПРО ДОСТУПНОСТЬ ПОТОКОВ.
 *
 * Все ссылки отдаются браузеру как есть. Собственного прокси у проекта больше
 * нет: он подставлял чужие Origin и Referer, то есть обходил ограничения
 * доступа, выставленные источником намеренно, и вдобавок гнал через себя весь
 * видеотрафик — каждый сегмент шёл через serverless-функцию, что и делало
 * воспроизведение и перемотку медленными.
 *
 * Практическое следствие: источники, которые не разрешают прямое обращение из
 * браузера, играться не будут. Это ожидаемое поведение. Штатные источники
 * воспроизведения в проекте — Jellyfin (своя медиатека) и Internet Archive
 * (общественное достояние); они через прокси никогда и не шли.
 */

import { config, tmdb } from '$lib/server/config';
import type { MediaType, PlaybackSource, SubtitleTrack, Translation } from '$lib/types';

const SOURCE_NAMES: Record<string, string> = {
	cobalt: 'Cobalt',
	titan: 'Titan',
	carbon: 'Carbon'
};

/*
 * Прокси /api/hls удалён.
 *
 * Он существовал ровно для того, чтобы обходить ограничения доступа, которые
 * источники выставили намеренно: подставлял чужие Origin и Referer, чтобы CDN
 * отдал манифест «своему» сайту. Заодно через него шёл ВЕСЬ видеотрафик — каждый
 * сегмент проходил через serverless-функцию, и именно это делало воспроизведение
 * и перемотку медленными.
 *
 * Теперь потоки отдаются браузеру как есть. Источники, которые не разрешают
 * прямое обращение, играться не будут — это ожидаемое следствие, а не поломка.
 */

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface UpstreamTranslation {
	id: string;
	label: string;
	url: string;
	type?: 'hls' | 'dash';
	uhd?: boolean;
}

interface UpstreamSource {
	sourceId: string;
	translations: UpstreamTranslation[];
	subtitles?: { url: string; lang?: string; label?: string; format?: string }[];
}

/* ------------------------------- кеш ответов ------------------------------- */

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: PlaybackSource | null }>();

function cacheGet(key: string): PlaybackSource | null | undefined {
	const hit = cache.get(key);
	if (!hit) return undefined;
	if (hit.at + CACHE_TTL_MS < Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return hit.value;
}

function cacheSet(key: string, value: PlaybackSource | null): void {
	if (cache.size > 200) {
		const oldest = cache.keys().next().value;
		if (oldest) cache.delete(oldest);
	}
	cache.set(key, { at: Date.now(), value });
}

/* --------------------------------- запрос --------------------------------- */

export interface ScrapeTarget {
	type: MediaType;
	tmdbId: number;
	season?: number;
	episode?: number;
}

async function fetchUpstream(target: ScrapeTarget, imdbId?: string): Promise<UpstreamSource[]> {
	const u = new URL(config.scrapers.apiUrl);
	u.searchParams.set('tmdbId', String(target.tmdbId));
	u.searchParams.set('type', target.type);
	u.searchParams.set('sources', config.scrapers.sources.join(','));
	if (imdbId) u.searchParams.set('imdbId', imdbId);
	if (target.type === 'show') {
		u.searchParams.set('season', String(target.season ?? 1));
		u.searchParams.set('episode', String(target.episode ?? 1));
	}

	const res = await fetch(u, {
		headers: {
			accept: 'application/json',
			origin: config.scrapers.apiOrigin,
			referer: config.scrapers.apiOrigin + '/',
			'user-agent': UA
		},
		signal: AbortSignal.timeout(15_000)
	});

	// Upstream может отдать «Content not found» и с HTTP 200, и с 404 —
	// статус не показатель, решение принимаем по телу ответа.
	const text = await res.text();
	let parsed: { success?: boolean; data?: UpstreamSource[]; error?: string } | null = null;
	try {
		parsed = JSON.parse(text);
	} catch {
		/* не JSON — ниже упадём с понятным сообщением */
	}

	if (parsed?.success && Array.isArray(parsed.data)) return parsed.data;
	if (parsed && /not found/i.test(parsed.error ?? '')) throw new ScrapeNotFoundError(parsed.error!);
	throw new Error(parsed?.error || `scrape API ответил ${res.status}`);
}

/** У CDN нет этого контента — детерминированный отказ, не сетевой сбой. */
class ScrapeNotFoundError extends Error {}

/* ------------------------------ преобразование ------------------------------ */

function toPlaybackSource(
	target: ScrapeTarget,
	sources: UpstreamSource[]
): PlaybackSource | null {
	const order = new Map(config.scrapers.sources.map((id, i) => [id, i]));
	const sorted = [...sources].sort(
		(a, b) => (order.get(a.sourceId) ?? 99) - (order.get(b.sourceId) ?? 99)
	);

	const translations: Translation[] = [];
	const subtitles: SubtitleTrack[] = [];
	let firstUrl: string | null = null;

	for (const src of sorted) {
		// Titan отдаёт HLS с obrut.show / чужих воркеров, закрытых по Origin:
		// браузер получает 403 и плеер зависает с невнятной ошибкой. Не играбельно
		// без собственного прокси — отсеиваем сразу, чтобы честное «нет в
		// источниках» показывалось вместо сломанного плеера.
		if (src.sourceId !== 'carbon') continue;
		const name = SOURCE_NAMES[src.sourceId] ?? src.sourceId;
		for (const t of src.translations ?? []) {
			if (!t.url) continue;
			if (!firstUrl) firstUrl = t.url;
			translations.push({
				id: `${src.sourceId}:${t.id}`,
				// Jellyfin-путь использует индексы дорожек; для скраперов индекс
				// не нужен, но поле обязательное — ставим порядковый номер.
				audioStreamIndex: translations.length,
				label: [name + ' · ' + (t.label || 'оригинал'), t.uhd ? '4K' : null]
					.filter(Boolean)
					.join(' · '),
				isDefault: translations.length === 0,
				url: t.url,
				manifest: t.type === 'dash' ? 'dash' : 'hls'
			});
		}

		for (const [i, s] of (src.subtitles ?? []).entries()) {
			subtitles.push({
				id: `${src.sourceId}:sub:${i}`,
				subtitleStreamIndex: i,
				label: [name, s.label ?? s.lang ?? 'субтитры'].join(' · '),
				language: s.lang,
				isForced: false,
				isHearingImpaired: false,
				url: s.url
			});
		}
	}

	// Поток берём у старшего по приоритету источника: порядок источников
	// подобран по играбельности в браузере, и HLS-предпочтение не должно
	// вытаскивать заблокированный поток из младшего источника поверх рабочего.
	const preferred = translations[0];
	if (!preferred || !firstUrl) return null;

	const epKey =
		target.type === 'show' ? `${target.season ?? 1}x${target.episode ?? 1}` : 'movie';

	return {
		jellyfinItemId: `scrapers:${target.type}:${target.tmdbId}:${epKey}`,
		mediaSourceId: 'cdn',
		playSessionId: `cdn-${target.tmdbId}-${epKey}`,
		streamUrl: preferred.url ?? firstUrl,
		// Поток чужой и уже готов к воспроизведению — транскодировать нечего.
		playMethod: 'DirectPlay',
		durationSec: 0,
		startPositionSec: 0,
		translations,
		activeTranslationId: preferred.id,
		subtitles,
		segments: []
	};
}

/* ---------------------------------- API ----------------------------------- */

export interface ScrapeResult {
	/** Поток, если нашёлся. */
	source: PlaybackSource | null;
	/** not_found — контента в CDN нет (повтор бессмыслен); upstream — временный сбой. */
	reason: 'ok' | 'not_found' | 'upstream';
	message?: string;
}

/* Причина последнего отказа по ключу. Ограничен, как и основной кеш. */
const negativeCache = new Map<string, 'not_found'>();
function rememberNegative(key: string): void {
	if (negativeCache.size > 200) {
		const oldest = negativeCache.keys().next().value;
		if (oldest) negativeCache.delete(oldest);
	}
	negativeCache.set(key, 'not_found');
}

/** Разрешает тайтл в потоки CDN. */
export async function scrapePlaybackSource(target: ScrapeTarget): Promise<ScrapeResult> {
	if (!config.scrapers.enabled) return { source: null, reason: 'upstream' };

	const key = `${target.type}:${target.tmdbId}:${target.season ?? ''}x${target.episode ?? ''}`;
	const cached = cacheGet(key);
	if (cached !== undefined) {
		// Отрицательный кеш хранит причину, чтобы повторные запросы не ходили в upstream зря.
		const neg = negativeCache.get(key);
		return { source: cached, reason: cached ? 'ok' : neg ?? 'upstream' };
	}

	try {
		const imdbId = await tmdb?.externalIds(target.type, target.tmdbId).then(
			(r) => r?.imdbId,
			() => undefined
		);
		const sources = await fetchUpstream(target, imdbId);
		const source = toPlaybackSource(target, sources);
		cacheSet(key, source);
		if (!source) rememberNegative(key);
		return { source, reason: source ? 'ok' : 'not_found' };
	} catch (e) {
		if (e instanceof ScrapeNotFoundError) {
			// Такого тайтла в CDN нет — кешируем надолго, повтор ничего не даст.
			cacheSet(key, null);
			rememberNegative(key);
			return { source: null, reason: 'not_found' };
		}
		console.warn(
			'[scrapers] не удалось получить потоки:',
			e instanceof Error ? e.message : e
		);
		// Временный сбой не кешируем — следующий запрос попробует снова.
		return { source: null, reason: 'upstream', message: e instanceof Error ? e.message : undefined };
	}
}

/** Включены ли CDN-источники — от этого зависит «играбельность» каталога. */
export const scrapersEnabled = (): boolean => config.scrapers.enabled;
