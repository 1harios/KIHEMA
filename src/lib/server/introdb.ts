/**
 * Таймкоды заставок, повторов, титров и анонсов из TheIntroDB.
 *
 * Чтение публичных сегментов не требует ключа. Ключ остаётся опциональным:
 * он пригодится, если позже добавим отправку собственных таймкодов.
 */

import { config } from '$lib/server/config';
import type { MediaSegment, MediaType } from '$lib/types';

interface IntroDbRange {
	start_ms: number | null;
	end_ms: number | null;
}

interface IntroDbResponse {
	intro?: IntroDbRange[];
	recap?: IntroDbRange[];
	credits?: IntroDbRange[];
	preview?: IntroDbRange[];
}

export interface IntroDbTarget {
	type: MediaType;
	tmdbId: number;
	season?: number;
	episode?: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const OPEN_END_SEC = 24 * 60 * 60;
const cache = new Map<string, { at: number; segments: MediaSegment[] }>();

function rangesToSegments(
	type: MediaSegment['type'],
	ranges: IntroDbRange[] | undefined
): MediaSegment[] {
	return (ranges ?? []).flatMap((range) => {
		const startSec = Math.max(0, (range.start_ms ?? 0) / 1000);
		// У титров end_ms часто равен null: это означает «до конца файла».
		// Плеер при перемотке сам ограничит эту точку реальной длительностью.
		const endSec = range.end_ms == null ? OPEN_END_SEC : range.end_ms / 1000;
		if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return [];
		return [{ type, startSec, endSec }];
	});
}

/** Получает публичные таймкоды. Ошибка сервиса не должна мешать запуску фильма. */
export async function getIntroDbSegments(target: IntroDbTarget): Promise<MediaSegment[]> {
	if (!config.introDb.enabled) return [];

	const key = `${target.type}:${target.tmdbId}:${target.season ?? ''}x${target.episode ?? ''}`;
	const cached = cache.get(key);
	if (cached && cached.at + CACHE_TTL_MS > Date.now()) return cached.segments;

	try {
		const url = new URL('/v3/media', config.introDb.baseUrl);
		url.searchParams.set('tmdb_id', String(target.tmdbId));
		if (target.type === 'show') {
			url.searchParams.set('season', String(target.season ?? 1));
			url.searchParams.set('episode', String(target.episode ?? 1));
		}

		const headers: Record<string, string> = {
			accept: 'application/json',
			'user-agent': 'KIHEMA/0.1 (+https://kihema.vercel.app)'
		};
		if (config.introDb.apiKey) headers.authorization = `Bearer ${config.introDb.apiKey}`;

		const response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(2_500)
		});
		if (response.status === 404) {
			cache.set(key, { at: Date.now(), segments: [] });
			return [];
		}
		if (!response.ok) throw new Error(`API ответил ${response.status}`);

		const data = (await response.json()) as IntroDbResponse;
		const segments = [
			...rangesToSegments('Intro', data.intro),
			...rangesToSegments('Recap', data.recap),
			...rangesToSegments('Outro', data.credits),
			...rangesToSegments('Preview', data.preview)
		].sort((a, b) => a.startSec - b.startSec);

		if (cache.size > 500) cache.delete(cache.keys().next().value ?? '');
		cache.set(key, { at: Date.now(), segments });
		return segments;
	} catch (error) {
		console.warn(
			'[introdb] не удалось получить таймкоды:',
			error instanceof Error ? error.message : error
		);
		return [];
	}
}

/** Сохраняет локальные/Jellyfin-сегменты и дополняет только отсутствующие типы. */
export function mergeMediaSegments(
	primary: MediaSegment[],
	additional: MediaSegment[]
): MediaSegment[] {
	const nativeTypes = new Set(primary.map((segment) => segment.type));
	return [
		...primary,
		...additional.filter((segment) => !nativeTypes.has(segment.type))
	].sort((a, b) => a.startSec - b.startSec);
}
