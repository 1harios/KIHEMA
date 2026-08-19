/**
 * Прогресс просмотра.
 *
 * Почему на клиенте, а не на сервере: серверный прогресс есть только у Jellyfin,
 * и он ключуется по своим идентификаторам. Без подключённой медиатеки — а на
 * Vercel её и не может быть, там нет ни доступа в домашнюю сеть, ни диска —
 * хранить позицию просто негде. localStorage работает всегда и сразу.
 *
 * Осознанная плата: между устройствами не синхронизируется и умирает вместе с
 * очисткой браузера. Когда Jellyfin подключён, серверный прогресс продолжает
 * работать параллельно и остаётся источником истины для самой медиатеки.
 *
 * Устройство хранилища такое же, как у истории поиска, и по той же причине:
 * канонические данные лежат в обычном массиве, а $state — только зеркало для
 * отрисовки. Эффект, который читает и пишет одно реактивное состояние, уходит в
 * бесконечный цикл и молча роняет гидрацию всей страницы.
 */

import { browser } from '$app/environment';
import type { CatalogItem, MediaType } from './types';

const KEY = 'kinema:progress:v1';
const MAX_ENTRIES = 24;

/** Меньше минуты — человек просто заглянул, это не «продолжить». */
const MIN_POSITION_SEC = 60;
/** Дальше 94% считаем досмотренным: предлагать «продолжить» уже нечего. */
const FINISHED_RATIO = 0.94;

export interface ProgressEntry {
	tmdbId: number;
	type: MediaType;
	title: string;
	originalTitle?: string;
	poster?: string;
	backdrop?: string;
	year?: number;
	/** Для сериала — какая серия смотрелась. */
	season?: number;
	episode?: number;
	episodeTitle?: string;
	positionSec: number;
	durationSec: number;
	updatedAt: number;
}

/* --------------------------------- хранилище ------------------------------- */

let raw: ProgressEntry[] = [];
let hydrated = false;

const state = $state<{ items: ProgressEntry[] }>({ items: [] });

/** Ключ записи. Для сериала позиция своя у каждой серии. */
const keyOf = (e: Pick<ProgressEntry, 'type' | 'tmdbId' | 'season' | 'episode'>) =>
	e.type === 'show' ? `show:${e.tmdbId}:${e.season ?? 1}:${e.episode ?? 1}` : `movie:${e.tmdbId}`;

function read(): ProgressEntry[] {
	if (!browser) return [];
	try {
		const stored = localStorage.getItem(KEY);
		if (!stored) return [];
		const parsed = JSON.parse(stored) as ProgressEntry[];
		return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
	} catch {
		return [];
	}
}

function write(): void {
	if (!browser) return;
	try {
		localStorage.setItem(KEY, JSON.stringify(raw));
	} catch {
		// Приватный режим или переполнение — прогресс не переживёт перезагрузку.
	}
}

function publish(): void {
	// Новые сверху: «продолжить просмотр» это история, а не алфавит.
	raw = raw.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES);
	state.items = raw;
	write();
}

export const progress = {
	get items() {
		return state.items;
	},

	init(): void {
		if (!browser || hydrated) return;
		hydrated = true;
		raw = read();
		state.items = raw;
	},

	/**
	 * Записать позицию. Вызывается плеером по таймеру, поэтому дёшево и молча
	 * отбрасывает то, что не имеет смысла хранить.
	 */
	save(entry: Omit<ProgressEntry, 'updatedAt'>): void {
		if (!browser) return;
		if (!entry.durationSec || entry.positionSec < MIN_POSITION_SEC) return;

		const key = keyOf(entry);

		// Досмотрел — запись убираем, иначе ряд «продолжить» забьётся законченным.
		if (entry.positionSec / entry.durationSec >= FINISHED_RATIO) {
			raw = raw.filter((e) => keyOf(e) !== key);
			publish();
			return;
		}

		raw = [{ ...entry, updatedAt: Date.now() }, ...raw.filter((e) => keyOf(e) !== key)];
		publish();
	},

	/** Доля просмотра 0..1 для карточки. undefined — не начинали. */
	ratioOf(type: MediaType, tmdbId: number): number | undefined {
		// У сериала берём самую свежую серию: на карточке сериала показываем
		// прогресс того, на чём человек остановился.
		const hit = state.items.find((e) => e.type === type && e.tmdbId === tmdbId);
		if (!hit || !hit.durationSec) return undefined;
		return Math.min(1, hit.positionSec / hit.durationSec);
	},

	remove(entry: Pick<ProgressEntry, 'type' | 'tmdbId' | 'season' | 'episode'>): void {
		const key = keyOf(entry);
		raw = raw.filter((e) => keyOf(e) !== key);
		publish();
	},

	clear(): void {
		raw = [];
		publish();
	}
};

/** Запись прогресса как карточка каталога — чтобы рисовать обычной сеткой. */
export const entryToItem = (e: ProgressEntry): CatalogItem => ({
	tmdbId: e.tmdbId,
	type: e.type,
	title: e.title,
	originalTitle: e.originalTitle,
	poster: e.poster,
	backdrop: e.backdrop,
	year: e.year,
	// Запись существует только для того, что реально игралось.
	inLibrary: true
});

/** Ссылка на продолжение с нужной секунды. */
export function resumeHref(e: ProgressEntry, base: string): string {
	const at = Math.floor(e.positionSec);
	return e.type === 'show'
		? `${base}/watch?s=${e.season ?? 1}&e=${e.episode ?? 1}&t=${at}`
		: `${base}/watch?t=${at}`;
}
