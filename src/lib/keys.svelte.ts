/**
 * Горячие клавиши: один реестр вместо обработчиков в каждом компоненте.
 *
 * Зачем понадобился реестр. До этого окно слушали независимо четыре места:
 * рельс (Escape закрывает выбор темы), страница тайтла (Escape закрывает
 * трейлер), поиск (дробь ставит курсор в поле) и плеер (свой набор). Пока
 * клавиш было три, это работало. С появлением просмотрщика галереи и переходов
 * по разделам начинаются столкновения, которые в такой схеме не лечатся:
 *
 * — Escape должен закрывать только верхний слой. При независимых обработчиках
 *   одно нажатие закрывает и просмотрщик, и трейлер, и меню темы сразу.
 * — Стрелки в просмотрщике должны листать картинки, а не слайды героя главной.
 * — Список клавиш в подсказке обязан совпадать с тем, что реально работает.
 *   Отдельный статичный список расходится с кодом на первой же правке.
 *
 * Отсюда устройство: области (scope) складываются в стек с приоритетом, событие
 * получает верхняя область, у которой есть подходящая привязка. Подсказка
 * строится из того же стека, поэтому соврать не может.
 *
 * Реактивность сделана так же, как в истории поиска и прогрессе просмотра:
 * канонические данные лежат в обычном массиве, а $state — только зеркало для
 * отрисовки. Эффект, который читает и пишет одно реактивное состояние, уходит в
 * бесконечный цикл и молча роняет гидрацию всей страницы.
 */

import { browser } from '$app/environment';

/** Группы в подсказке. Порядок здесь же задаёт порядок в панели. */
export const KEY_GROUPS = ['Плеер', 'Просмотр', 'Навигация', 'Общее'] as const;
export type KeyGroup = (typeof KEY_GROUPS)[number];

export interface KeyBinding {
	/**
	 * Что нажимать. Одна привязка может иметь несколько вариантов: ['k', ' '].
	 * Последовательность записывается через пробел внутри строки: 'g h'.
	 */
	combos: string[];
	/** Как показать в подсказке: 'Пробел', 'K', '← →', 'G затем H'. */
	hint: string;
	/** Что делает — текстом для человека. */
	title: string;
	group: KeyGroup;
	run: (e: KeyboardEvent) => void;
	/** Не показывать в подсказке: служебные вроде Escape внутри слоя. */
	hidden?: boolean;
}

export interface KeyScope {
	id: string;
	/**
	 * Приоритет. Больше — выше в стеке. Договорённость:
	 * 0 — страница, 10 — плеер, 50 — выпадающие панели, 100 — модальные слои.
	 */
	priority: number;
	bindings: KeyBinding[];
}

/* ------------------------------- состояние -------------------------------- */

let scopes: KeyScope[] = [];
let installed = false;

/** Зеркало для подсказки: массив всех привязок сверху вниз по стеку. */
const view = $state<{ bindings: KeyBinding[] }>({ bindings: [] });

/** Незавершённая последовательность вроде «g» в ожидании второй клавиши. */
let pending = '';
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function publish(): void {
	// Сортировка по убыванию приоритета: и разбор события, и подсказка идут
	// сверху стека, поэтому порядок нужен один раз здесь.
	scopes = [...scopes].sort((a, b) => b.priority - a.priority);
	view.bindings = scopes.flatMap((s) => s.bindings);
}

/** Печатает ли пользователь прямо сейчас — тогда клавиши не наши. */
function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return (
		el instanceof HTMLInputElement ||
		el instanceof HTMLTextAreaElement ||
		el instanceof HTMLSelectElement ||
		Boolean(el?.isContentEditable)
	);
}

/** Нормализованное имя клавиши: буквы в нижний регистр, остальное как есть. */
const nameOf = (e: KeyboardEvent): string =>
	e.key.length === 1 ? e.key.toLowerCase() : e.key;

function clearPending(): void {
	pending = '';
	if (pendingTimer) clearTimeout(pendingTimer);
	pendingTimer = null;
}

function handle(e: KeyboardEvent): void {
	// Ctrl, Cmd и Alt отдаём браузеру и системе: перехватывать Cmd+L или Ctrl+T
	// нельзя ни при каких обстоятельствах. Shift оставляем — без него не набрать
	// ни знак вопроса, ни угловые скобки.
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (isTyping(e.target)) return;

	const key = nameOf(e);

	// Сначала пробуем продолжение последовательности: «g» уже нажата.
	if (pending) {
		const combo = `${pending} ${key}`;
		clearPending();
		if (dispatch(combo, e)) return;
		// Не сложилось — падаем ниже и пробуем клавишу саму по себе.
	}

	if (dispatch(key, e)) return;

	// Клавиша сама ничего не делает, но начинает известную последовательность.
	const startsSequence = scopes.some((s) =>
		s.bindings.some((b) => b.combos.some((c) => c.startsWith(`${key} `)))
	);
	if (startsSequence) {
		pending = key;
		// Полторы секунды: успеть нажать вторую клавишу, но не держать состояние
		// висящим, иначе следующее одиночное нажатие уйдёт не туда.
		pendingTimer = setTimeout(clearPending, 1500);
		e.preventDefault();
	}
}

/** Отдаёт событие первой сверху области, у которой есть такая привязка. */
function dispatch(combo: string, e: KeyboardEvent): boolean {
	for (const scope of scopes) {
		const hit = scope.bindings.find((b) => b.combos.includes(combo));
		if (hit) {
			e.preventDefault();
			hit.run(e);
			return true;
		}
	}
	return false;
}

/* --------------------------------- API ------------------------------------ */

/**
 * Регистрирует область клавиш. Возвращает функцию снятия — её отдают из
 * $effect, поэтому область живёт ровно столько, сколько компонент.
 */
export function registerKeys(scope: KeyScope): () => void {
	if (!browser) return () => undefined;

	if (!installed) {
		installed = true;
		// capture: true — чтобы слой перехватывал клавишу раньше, чем до неё
		// доберётся что-то ниже по дереву.
		window.addEventListener('keydown', handle, { capture: true });
	}

	scopes = [...scopes.filter((s) => s.id !== scope.id), scope];
	publish();

	return () => {
		scopes = scopes.filter((s) => s.id !== scope.id);
		clearPending();
		publish();
	};
}

/** Все действующие привязки — для панели подсказки. */
export const keyRegistry = {
	get bindings() {
		return view.bindings;
	},
	/** Сгруппировано и без служебных — ровно то, что показываем человеку. */
	get groups() {
		const out: { group: KeyGroup; items: KeyBinding[] }[] = [];
		for (const group of KEY_GROUPS) {
			const items = view.bindings.filter((b) => b.group === group && !b.hidden);
			if (items.length) out.push({ group, items });
		}
		return out;
	}
};

/* ------------------------------ вспомогательное --------------------------- */

/**
 * Панель подсказки — общее состояние, потому что открывать её должны и сайт, и
 * плеер, а живёт она в разметке макета.
 */
const helpState = $state({ open: false });

export const keyHelp = {
	get open() {
		return helpState.open;
	},
	toggle(): void {
		helpState.open = !helpState.open;
	},
	close(): void {
		helpState.open = false;
	}
};
