/**
 * Ленивая загрузка логотипов тайтлов для карточек.
 *
 * Почему так, а не просто полем в CatalogItem: TMDB не отдаёт логотипы в
 * списочных ответах. Единственный способ получить их для ряда из двадцати
 * карточек — двадцать отдельных запросов, и делать это на сервере при отрисовке
 * главной нельзя: там девять рядов.
 *
 * Поэтому:
 *   — карточка сообщает о себе только когда попала в кадр (IntersectionObserver);
 *   — запросы копятся 80 мс и уходят одним батчем на /api/logos;
 *   — результат живёт в общей карте на всё приложение, включая «нет логотипа»,
 *     чтобы не спрашивать одно и то же дважды.
 *
 * Отсутствие логотипа — обычное дело (у непопулярных тайтлов их нет), поэтому
 * null кешируется наравне с URL.
 */

import { browser } from '$app/environment';
import type { MediaType } from './types';

/** Ключ карты. Тип обязателен: id фильма и сериала могут совпадать. */
const keyOf = (type: MediaType, id: number) => `${type}:${id}`;

/** URL логотипа, либо null если его нет. Отсутствие ключа = ещё не спрашивали. */
const cache = $state<Record<string, string | null>>({});

/** Что ждёт отправки, разложенное по типу. */
const queue: Record<MediaType, Set<number>> = { movie: new Set(), show: new Set() };

/** Что уже в полёте — чтобы повторный показ карточки не дублировал запрос. */
const inFlight = new Set<string>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Сколько id уходит в один запрос. Совпадает с лимитом эндпоинта. */
const BATCH = 24;
const DEBOUNCE_MS = 80;

async function flush() {
	flushTimer = null;

	for (const type of ['movie', 'show'] as MediaType[]) {
		const set = queue[type];
		if (!set.size) continue;

		const ids = [...set].slice(0, BATCH);
		for (const id of ids) set.delete(id);

		const params = new URLSearchParams({ type, ids: ids.join(',') });

		try {
			const res = await fetch(`/api/logos?${params}`);
			if (!res.ok) throw new Error(String(res.status));
			const payload = (await res.json()) as Record<string, string | null>;

			for (const id of ids) {
				cache[keyOf(type, id)] = payload[String(id)] ?? null;
				inFlight.delete(keyOf(type, id));
			}
		} catch {
			// Помечаем как «нет логотипа»: карточка покажет название текстом.
			// Повторять бессмысленно — при отказе сети её всё равно нет.
			for (const id of ids) {
				cache[keyOf(type, id)] = null;
				inFlight.delete(keyOf(type, id));
			}
		}

		// Осталось больше батча — добираем следующим проходом.
		if (set.size) schedule();
	}
}

function schedule() {
	if (flushTimer) return;
	flushTimer = setTimeout(flush, DEBOUNCE_MS);
}

/** Читает логотип из карты. undefined — ещё не знаем. */
export function logoOf(type: MediaType, id: number): string | null | undefined {
	return cache[keyOf(type, id)];
}

export function requestLogo(type: MediaType, id: number): void {
	if (!browser) return;
	const key = keyOf(type, id);
	if (key in cache || inFlight.has(key)) return;

	inFlight.add(key);
	queue[type].add(id);
	schedule();
}

/**
 * Действие для карточки: просит логотип, когда элемент появился в кадре.
 *
 * Наблюдатель один на приложение — по одному на карточку это сотни наблюдателей
 * на главной. rootMargin с запасом, чтобы логотип успел приехать до того, как
 * карточка окажется в центре внимания.
 */
let observer: IntersectionObserver | null = null;
const watched = new WeakMap<Element, { type: MediaType; id: number }>();

function ensureObserver(): IntersectionObserver | null {
	if (!browser) return null;
	if (observer) return observer;

	observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const target = watched.get(entry.target);
				if (target) requestLogo(target.type, target.id);
				// Больше следить не нужно: результат кешируется навсегда.
				observer?.unobserve(entry.target);
				watched.delete(entry.target);
			}
		},
		{ rootMargin: '200px' }
	);
	return observer;
}

type LogoTarget = { type: MediaType; id: number } | undefined;

export function trackLogo(node: HTMLElement, params: LogoTarget) {
	const io = ensureObserver();
	// params === undefined — логотипы для этой карточки отключены пропом.
	if (!io || !params) return {};

	watched.set(node, params);
	io.observe(node);

	return {
		update(next: LogoTarget) {
			if (next) watched.set(node, next);
		},
		destroy() {
			io.unobserve(node);
			watched.delete(node);
		}
	};
}
