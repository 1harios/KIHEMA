/**
 * Индекс соответствия TMDB ID -> Jellyfin ID.
 *
 * Зачем он вообще нужен.
 * В Jellyfin нельзя спросить «дай мне тайтл с TMDB ID = 603». Параметр
 * AnyProviderIdEquals, который есть в Emby, в Jellyfin сломан и возвращает всю
 * библиотеку целиком, а hasTmdbId=true фильтрует лишь по факту наличия любого id.
 * Поэтому единственный надёжный путь — один раз обойти библиотеку, прочитать
 * ProviderIds.Tmdb у каждого элемента и построить обратную карту у себя.
 *
 * Индекс держим в памяти и дублируем на диск, чтобы переживать рестарт.
 * Для личной медиатеки в тысячи тайтлов этого более чем достаточно; переезд на
 * SQLite имеет смысл где-то после сотни тысяч элементов.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JellyfinClient } from './jellyfin';
import { getTmdbId } from './jellyfin';

const INDEX_VERSION = 1;

export interface MovieEntry {
	jellyfinId: string;
	name: string;
	year?: number;
}

export interface EpisodeEntry {
	jellyfinId: string;
	season: number;
	episode: number;
	name: string;
}

export interface ShowEntry {
	jellyfinId: string;
	name: string;
	year?: number;
	/** Ключ «s1e2» -> серия. Нужен, чтобы отмечать наличие поштучно. */
	episodes: Record<string, EpisodeEntry>;
}

export interface LibraryIndexData {
	version: number;
	builtAt: string;
	movies: Record<string, MovieEntry>;
	shows: Record<string, ShowEntry>;
	stats: {
		movieCount: number;
		showCount: number;
		episodeCount: number;
		/** Элементы без TMDB ID — их стоит показать админу, метаданные не подтянулись. */
		unmatched: number;
		durationMs: number;
	};
}

export const episodeKey = (season: number, episode: number): string => `s${season}e${episode}`;

const emptyIndex = (): LibraryIndexData => ({
	version: INDEX_VERSION,
	builtAt: new Date(0).toISOString(),
	movies: {},
	shows: {},
	stats: { movieCount: 0, showCount: 0, episodeCount: 0, unmatched: 0, durationMs: 0 }
});

export class LibraryIndex {
	private data: LibraryIndexData = emptyIndex();
	private building: Promise<LibraryIndexData> | null = null;

	constructor(private readonly filePath: string) {}

	get snapshot(): LibraryIndexData {
		return this.data;
	}

	get isEmpty(): boolean {
		return this.data.stats.movieCount === 0 && this.data.stats.showCount === 0;
	}

	get builtAt(): Date {
		return new Date(this.data.builtAt);
	}

	async load(): Promise<void> {
		try {
			const raw = await readFile(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as LibraryIndexData;
			if (parsed.version === INDEX_VERSION) {
				this.data = parsed;
				return;
			}
			console.warn('[index] версия индекса устарела, требуется пересборка');
		} catch {
			// Файла нет — нормальная ситуация при первом запуске.
		}
	}

	private async persist(): Promise<void> {
		try {
			await mkdir(dirname(this.filePath), { recursive: true });
			// Пишем через временный файл: падение посреди записи иначе оставит битый JSON.
			const tmp = `${this.filePath}.tmp`;
			await writeFile(tmp, JSON.stringify(this.data), 'utf8');
			await rename(tmp, this.filePath);
		} catch (e) {
			// На serverless (Vercel и т.п.) диск только для чтения. Это не ошибка:
			// индекс остаётся в памяти инстанса, просто не переживёт холодный старт.
			const code = (e as NodeJS.ErrnoException)?.code;
			if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
				console.warn('[index] диск только для чтения, индекс держим в памяти');
				return;
			}
			throw e;
		}
	}

	/**
	 * Ленивое обновление вместо фонового таймера.
	 *
	 * На serverless между запросами процесс не живёт, setInterval там бессмыслен.
	 * Поэтому свежесть проверяем на запросе: если индекс протух — запускаем
	 * пересборку, но НЕ ждём её, чтобы не задерживать ответ.
	 */
	ensureFresh(client: JellyfinClient, maxAgeMinutes: number, userId?: string): void {
		if (this.building) return;
		const ageMinutes = (Date.now() - this.builtAt.getTime()) / 60_000;
		if (!this.isEmpty && ageMinutes < maxAgeMinutes) return;

		this.rebuild(client, userId).catch((e) =>
			console.error('[index] фоновая пересборка не удалась:', e?.message ?? e)
		);
	}

	/* ------------------------------- чтение -------------------------------- */

	findMovie(tmdbId: number): MovieEntry | undefined {
		return this.data.movies[String(tmdbId)];
	}

	findShow(tmdbId: number): ShowEntry | undefined {
		return this.data.shows[String(tmdbId)];
	}

	findEpisode(tmdbId: number, season: number, episode: number): EpisodeEntry | undefined {
		return this.data.shows[String(tmdbId)]?.episodes[episodeKey(season, episode)];
	}

	has(tmdbId: number, type: 'movie' | 'show'): boolean {
		return type === 'movie' ? !!this.findMovie(tmdbId) : !!this.findShow(tmdbId);
	}

	/** Массовая проверка для сетки каталога — один проход вместо N вызовов. */
	markPresence<T extends { tmdbId: number; type: 'movie' | 'show' }>(
		items: T[]
	): (T & { inLibrary: boolean; jellyfinId?: string })[] {
		return items.map((item) => {
			const entry =
				item.type === 'movie' ? this.findMovie(item.tmdbId) : this.findShow(item.tmdbId);
			return { ...item, inLibrary: !!entry, jellyfinId: entry?.jellyfinId };
		});
	}

	/* -------------------------------- сборка -------------------------------- */

	/**
	 * Полный обход библиотеки.
	 *
	 * Повторный вызов во время сборки не запускает вторую — возвращается та же
	 * промис-ссылка. Иначе крон и ручной запуск могут наложиться.
	 */
	async rebuild(client: JellyfinClient, userId?: string): Promise<LibraryIndexData> {
		if (this.building) return this.building;
		this.building = this.doRebuild(client, userId).finally(() => {
			this.building = null;
		});
		return this.building;
	}

	private async doRebuild(client: JellyfinClient, userId?: string): Promise<LibraryIndexData> {
		const startedAt = Date.now();
		const next = emptyIndex();
		let unmatched = 0;

		// --- фильмы ---
		for await (const item of paginate(client, ['Movie'], userId)) {
			const tmdbId = getTmdbId(item);
			if (tmdbId == null) {
				unmatched++;
				continue;
			}
			next.movies[String(tmdbId)] = {
				jellyfinId: item.Id,
				name: item.Name,
				year: item.ProductionYear ?? undefined
			};
		}

		// --- сериалы ---
		const showsByJellyfinId = new Map<string, string>(); // jellyfinId сериала -> tmdbId
		for await (const item of paginate(client, ['Series'], userId)) {
			const tmdbId = getTmdbId(item);
			if (tmdbId == null) {
				unmatched++;
				continue;
			}
			next.shows[String(tmdbId)] = {
				jellyfinId: item.Id,
				name: item.Name,
				year: item.ProductionYear ?? undefined,
				episodes: {}
			};
			showsByJellyfinId.set(item.Id, String(tmdbId));
		}

		// --- серии ---
		// Один общий запрос по типу Episode дешевле, чем N запросов на сериал:
		// у каждой серии есть SeriesId, по нему и раскладываем.
		for await (const ep of paginate(client, ['Episode'], userId)) {
			const seriesTmdb = ep.SeriesId ? showsByJellyfinId.get(ep.SeriesId) : undefined;
			if (!seriesTmdb) continue;

			const season = ep.ParentIndexNumber;
			const episode = ep.IndexNumber;
			if (season == null || episode == null) continue;

			next.shows[seriesTmdb].episodes[episodeKey(season, episode)] = {
				jellyfinId: ep.Id,
				season,
				episode,
				name: ep.Name
			};
		}

		next.stats = {
			movieCount: Object.keys(next.movies).length,
			showCount: Object.keys(next.shows).length,
			episodeCount: Object.values(next.shows).reduce(
				(sum, s) => sum + Object.keys(s.episodes).length,
				0
			),
			unmatched,
			durationMs: Date.now() - startedAt
		};
		next.builtAt = new Date().toISOString();

		this.data = next;
		await this.persist();

		console.log(
			`[index] собран за ${next.stats.durationMs} мс: ` +
				`${next.stats.movieCount} фильмов, ${next.stats.showCount} сериалов, ` +
				`${next.stats.episodeCount} серий, без TMDB ID — ${unmatched}`
		);
		return next;
	}
}

/** Постраничный итератор по библиотеке. Jellyfin плохо реагирует на limit в тысячи. */
async function* paginate(
	client: JellyfinClient,
	types: string[],
	userId?: string,
	pageSize = 500
): AsyncGenerator<import('./jellyfin').JfItem> {
	let startIndex = 0;

	for (;;) {
		const page = await client.listItems({
			userId,
			includeItemTypes: types,
			startIndex,
			limit: pageSize,
			fields: ['ProviderIds']
		});

		const items = page.Items ?? [];
		for (const item of items) yield item;

		startIndex += items.length;
		if (items.length < pageSize || startIndex >= (page.TotalRecordCount ?? 0)) break;
	}
}
