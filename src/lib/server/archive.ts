/**
 * Internet Archive как источник воспроизведения.
 *
 * Второй адаптер источника рядом с Jellyfin — ровно та развилка, под которую
 * проектировался PlaybackSource. Каталог и плеер про него ничего не знают:
 * снаружи это такой же тайтл, который «можно включить».
 *
 * Индекс собирается заранее скриптом scripts/build-archive-index.mjs и уезжает
 * в деплой готовым JSON. На старте ничего не скачивается: на serverless любой
 * сетевой прогрев не пережил бы холодный старт, а пользователь ждал бы впустую.
 *
 * Права: в индекс попадают фильмы из коллекций общественного достояния
 * (feature_films, film_noir, silent_films, sci-fi_horror). Их можно смотреть
 * и распространять свободно.
 */

import indexData from '$lib/data/archive-index.json';
import type { CatalogItem, PlaybackSource, Translation } from '$lib/types';

export interface ArchiveFilm {
	tmdbId: number;
	title: string;
	year: number | null;
	identifier: string;
	file: string;
	durationSec: number;
	sizeMb: number;
	/* Метаданные вшиты в индекс на этапе сборки — чтобы ряд на главной
	   не делал под сотню запросов в TMDB на каждый заход. */
	poster?: string | null;
	backdrop?: string | null;
	overview?: string | null;
	rating?: number | null;
	genres?: string[];
}

const films = (indexData as { films: ArchiveFilm[] }).films ?? [];
const byTmdb = new Map<number, ArchiveFilm>(films.map((f) => [f.tmdbId, f]));

export const archiveCount = films.length;

export const findArchiveFilm = (tmdbId: number): ArchiveFilm | undefined => byTmdb.get(tmdbId);

export const hasArchiveFilm = (tmdbId: number): boolean => byTmdb.has(tmdbId);

/**
 * Постеры в индексе вшиты прямыми ссылками на image.tmdb.org — провайдеры,
 * блокирующие TMDB по DNS, их не грузят. Пропускаем через наш /api/img.
 */
const viaProxy = (url?: string | null): string | undefined => {
	if (!url) return undefined;
	const m = url.match(/^https:\/\/image\.tmdb\.org\/t\/p(\/.+)$/);
	return m ? `/api/img?src=${encodeURIComponent(m[1])}` : url ?? undefined;
};

/** Готовые карточки для ряда «Смотреть бесплатно» — без обращений к TMDB. */
export function archiveCatalog(): CatalogItem[] {
	return films.map((f) => ({
		tmdbId: f.tmdbId,
		type: 'movie' as const,
		title: f.title,
		year: f.year ?? undefined,
		overview: f.overview ?? undefined,
		poster: viaProxy(f.poster),
		backdrop: viaProxy(f.backdrop),
		rating: f.rating ?? undefined,
		genres: f.genres,
		inLibrary: true,
		jellyfinId: `archive:${f.identifier}`
	}));
}

/** Свежие поступления вперёд — на главной интереснее видеть разнообразие. */
export function archiveHighlights(limit = 18): CatalogItem[] {
	return [...archiveCatalog()]
		.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
		.slice(0, limit);
}

/**
 * Прямая ссылка на файл.
 *
 * Отдаёт 302 на конкретную ноду архива, но Range-запросы поддерживаются на всём
 * пути, так что перемотка в плеере работает.
 */
export const archiveStreamUrl = (film: ArchiveFilm): string =>
	`https://archive.org/download/${film.identifier}/${encodeURIComponent(film.file)}`;

/**
 * Источник для плеера.
 *
 * Дорожка всегда одна: это оцифровки, отдельных озвучек в них нет. Выпадающий
 * список в плеере при этом остаётся — просто с единственным пунктом, и видно,
 * что механика та же, что была бы с Jellyfin.
 */
export function archivePlaybackSource(film: ArchiveFilm): PlaybackSource {
	const only: Translation = {
		id: 'a0',
		audioStreamIndex: 0,
		label: 'Оригинальная дорожка',
		isDefault: true
	};

	return {
		jellyfinItemId: `archive:${film.identifier}`,
		mediaSourceId: film.identifier,
		playSessionId: `archive-${film.identifier}`,
		streamUrl: archiveStreamUrl(film),
		// Прямой файл, без транскодирования на нашей стороне.
		playMethod: 'DirectPlay',
		durationSec: film.durationSec,
		startPositionSec: 0,
		translations: [only],
		activeTranslationId: only.id,
		subtitles: [],
		segments: []
	};
}

/** Проставляет играбельность по архиву поверх карточек каталога. */
export function markArchive(items: CatalogItem[]): CatalogItem[] {
	return items.map((item) => {
		if (item.inLibrary || item.type !== 'movie') return item;
		const film = byTmdb.get(item.tmdbId);
		return film ? { ...item, inLibrary: true, jellyfinId: `archive:${film.identifier}` } : item;
	});
}

export const isArchiveId = (id: string | undefined): boolean => Boolean(id?.startsWith('archive:'));
