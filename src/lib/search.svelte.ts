/**
 * Живой поиск: состояние подсказок и история запросов.
 *
 * Три вещи, без которых живой поиск работает плохо, и все три здесь есть:
 *
 * 1. ОТМЕНА. Набирая «человек», пользователь отправляет запросы на «че», «чел»,
 *    «челов»… Ответы приходят в произвольном порядке, и в списке легко остаётся
 *    результат от устаревшего запроса — самый заметный баг такого поиска.
 *    Поэтому каждый новый запрос отменяет предыдущий через AbortController, а
 *    результат принимается только если он от текущей строки.
 *
 * 2. ЗАДЕРЖКА. Без неё запрос уходит на каждое нажатие клавиши.
 *
 * 3. КЕШ. Возврат к уже набранному (стёр букву — вернул) не должен идти в сеть.
 */

import { browser } from '$app/environment';
import type { CatalogItem } from './types';

export interface PersonHit {
	id: number;
	name: string;
	photo?: string;
	knownFor: string;
}

interface Payload {
	titles: CatalogItem[];
	people: PersonHit[];
	totalResults: number;
}

const EMPTY: Payload = { titles: [], people: [], totalResults: 0 };

const DEBOUNCE_MS = 220;
/** Меньше двух символов не ищем: выдача бессмысленная, лимит расходуется зря. */
const MIN_CHARS = 2;
const HISTORY_KEY = 'kinema:search-history:v1';
const HISTORY_MAX = 8;

const state = $state({
	query: '',
	loading: false,
	/** Результат ровно для state.query. */
	result: EMPTY,
	history: [] as string[]
});

const cache = new Map<string, Payload>();
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/* -------------------------------- история --------------------------------- */

/**
 * Канонический список истории — ОБЫЧНЫЙ массив, не $state.
 *
 * Это принципиально. Обе функции ниже вызываются из $effect в компонентах, а
 * эффект, который читает и пишет одно и то же реактивное состояние, уходит в
 * бесконечный цикл: Svelte упирается в предел глубины обновлений и роняет
 * гидрацию — страница перестаёт быть интерактивной целиком, молча.
 *
 * Поэтому читаем всегда из обычного массива, а state.history остаётся только
 * зеркалом для отрисовки: в него пишут, но из него не читают.
 */
let historyRaw: string[] = [];
let hydrated = false;

function readHistory(): string[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(HISTORY_KEY);
		return raw ? (JSON.parse(raw) as string[]).slice(0, HISTORY_MAX) : [];
	} catch {
		return [];
	}
}

function writeHistory() {
	if (!browser) return;
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRaw));
	} catch {
		// Приватный режим — история просто не переживёт перезагрузку.
	}
}

/* --------------------------------- запрос --------------------------------- */

async function run(term: string) {
	const cached = cache.get(term);
	if (cached) {
		state.result = cached;
		state.loading = false;
		return;
	}

	// Предыдущий запрос больше не нужен: его ответ уже неактуален.
	controller?.abort();
	controller = new AbortController();

	state.loading = true;

	try {
		const params = new URLSearchParams({ q: term, compact: '1' });
		const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
		if (!res.ok) throw new Error(String(res.status));
		const payload = (await res.json()) as Payload;

		cache.set(term, payload);

		// Пока запрос шёл, строка могла измениться — тогда результат чужой.
		if (state.query.trim() === term) {
			state.result = payload;
			state.loading = false;
		}
	} catch (e) {
		// AbortError — это мы сами отменили, и он не ошибка.
		if ((e as Error)?.name === 'AbortError') return;
		if (state.query.trim() === term) {
			state.result = EMPTY;
			state.loading = false;
		}
	}
}

export const search = {
	get query() {
		return state.query;
	},
	get loading() {
		return state.loading;
	},
	get titles() {
		return state.result.titles;
	},
	get people() {
		return state.result.people;
	},
	get totalResults() {
		return state.result.totalResults;
	},
	get history() {
		return state.history;
	},

	/** Есть ли что показывать в выпадающем списке. */
	get hasResults() {
		return state.result.titles.length > 0 || state.result.people.length > 0;
	},

	init() {
		// Флаг обычный, не реактивный: читать здесь state.history нельзя, см. выше.
		if (!browser || hydrated) return;
		hydrated = true;
		historyRaw = readHistory();
		state.history = historyRaw;
	},

	/** Ввод из поля. Ставит задержку и отменяет предыдущий запрос. */
	setQuery(value: string) {
		state.query = value;
		const term = value.trim();

		if (timer) clearTimeout(timer);

		if (term.length < MIN_CHARS) {
			controller?.abort();
			state.result = EMPTY;
			state.loading = false;
			return;
		}

		// Показываем кеш сразу, не дожидаясь задержки: возврат к набранному
		// должен быть мгновенным.
		const cached = cache.get(term);
		if (cached) state.result = cached;

		timer = setTimeout(() => run(term), DEBOUNCE_MS);
	},

	/** Запомнить запрос — вызывается при переходе к результатам. */
	remember(value: string) {
		const term = value.trim();
		if (term.length < MIN_CHARS) return;
		// Уже первый в списке — ничего не меняем: иначе эффект, который зовёт
		// remember на смену запроса, будет писать состояние на каждый проход.
		if (historyRaw[0] === term) return;

		historyRaw = [term, ...historyRaw.filter((h) => h !== term)].slice(0, HISTORY_MAX);
		state.history = historyRaw;
		writeHistory();
	},

	clearHistory() {
		historyRaw = [];
		state.history = historyRaw;
		writeHistory();
	},

	reset() {
		if (timer) clearTimeout(timer);
		controller?.abort();
		state.query = '';
		state.result = EMPTY;
		state.loading = false;
	}
};
