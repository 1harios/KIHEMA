/**
 * Личные списки: «смотреть позже» и «избранное».
 *
 * Сознательно без сервера. Аккаунт здесь — это учётка Jellyfin, а Jellyfin не
 * хранит списки по TMDB ID; на Vercel записываемого диска вообще нет. Поэтому
 * списки живут в localStorage: работают сразу, не требуют входа и не создают
 * ложного ощущения синхронизации между устройствами.
 *
 * Храним снимок карточки (постер, год, рейтинг), а не только ID: иначе страница
 * списка на десять тайтлов означала бы десять запросов к TMDB перед первой
 * отрисовкой.
 */

import { browser } from '$app/environment';
import type { CatalogItem, ListEntry, ListKind, MediaType } from './types';

const KEY = 'kinema:lists:v1';

type Store = Record<ListKind, ListEntry[]>;

const empty = (): Store => ({ later: [], favorite: [] });

function read(): Store {
	if (!browser) return empty();
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return empty();
		const parsed = JSON.parse(raw) as Partial<Store>;
		return { later: parsed.later ?? [], favorite: parsed.favorite ?? [] };
	} catch {
		// Битый JSON не должен ронять страницу — начинаем с чистого списка.
		return empty();
	}
}

/** Единое реактивное состояние на всё приложение. */
const state = $state<Store>(empty());

let hydrated = false;

/** Чтение localStorage только в браузере и только один раз. */
export function initLists(): void {
	if (!browser || hydrated) return;
	const stored = read();
	state.later = stored.later;
	state.favorite = stored.favorite;
	hydrated = true;
}

function persist(): void {
	if (!browser) return;
	try {
		localStorage.setItem(KEY, JSON.stringify(state));
	} catch {
		// Приватный режим или переполненное хранилище. Список останется в памяти
		// до перезагрузки — это лучше, чем упасть на записи.
	}
}

const sameItem = (e: ListEntry, tmdbId: number, type: MediaType) =>
	e.tmdbId === tmdbId && e.type === type;

export const lists = {
	get later() {
		return state.later;
	},
	get favorite() {
		return state.favorite;
	},

	has(kind: ListKind, tmdbId: number, type: MediaType): boolean {
		return state[kind].some((e) => sameItem(e, tmdbId, type));
	},

	/** Переключает наличие. Возвращает новое состояние — удобно для aria-pressed. */
	toggle(kind: ListKind, item: CatalogItem): boolean {
		const idx = state[kind].findIndex((e) => sameItem(e, item.tmdbId, item.type));
		if (idx >= 0) {
			state[kind].splice(idx, 1);
			persist();
			return false;
		}
		// Новое — в начало: список читается как история добавлений.
		state[kind].unshift({
			tmdbId: item.tmdbId,
			type: item.type,
			title: item.title,
			poster: item.poster,
			year: item.year,
			rating: item.rating,
			addedAt: Date.now()
		});
		persist();
		return true;
	},

	remove(kind: ListKind, tmdbId: number, type: MediaType): void {
		const idx = state[kind].findIndex((e) => sameItem(e, tmdbId, type));
		if (idx >= 0) {
			state[kind].splice(idx, 1);
			persist();
		}
	},

	clear(kind: ListKind): void {
		state[kind] = [];
		persist();
	},

	count(kind: ListKind): number {
		return state[kind].length;
	}
};

/** Записи списка обратно в CatalogItem — для отрисовки обычной сеткой. */
export const entryToItem = (e: ListEntry): CatalogItem => ({
	tmdbId: e.tmdbId,
	type: e.type,
	title: e.title,
	poster: e.poster,
	year: e.year,
	rating: e.rating,
	inLibrary: false
});
