/**
 * Навигация стрелками для телевизора.
 *
 * На ТВ нет ни мыши, ни касаний — только пульт, который присылает стрелки и
 * Enter. Обычный Tab-порядок для этого не годится: он линейный, а сетка постеров
 * двумерная, и «вправо» по Tab уводит из ряда в подвал.
 *
 * ГЛАВНОЕ РЕШЕНИЕ — когда это включать. Просто «ширина от 1920» не подходит: на
 * 4K-мониторе стрелки перестали бы прокручивать страницу, а это заметная поломка
 * для обычного пользователя. Поэтому включаемся только если браузер похож на
 * телевизионный по строке агента, либо экран широкий И у устройства нет наведения
 * (то есть указателя нет вовсе). Настольный монитор с мышью под это не попадает.
 */

import { browser } from '$app/environment';

/** Строки агентов телевизоров и приставок. */
const TV_UA =
  /\b(smart-?tv|smarttv|tizen|web0?os|netcast|viera|bravia|aquos|hbbtv|philipstv|googletv|android\s?tv|crkey|aft[a-z]*|dtv|inettvbrowser)\b/i;

function isTvLike(): boolean {
	if (!browser) return false;
	if (TV_UA.test(navigator.userAgent)) return true;
	// Широкий экран без возможности наведения — почти наверняка телевизор.
	return (
		window.matchMedia('(min-width: 1920px)').matches && window.matchMedia('(hover: none)').matches
	);
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Видимые и реально достижимые элементы. */
function candidates(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
		if (el.hasAttribute('aria-hidden')) return false;
		const rect = el.getBoundingClientRect();
		// Нулевой размер = скрыт через display/visibility или свёрнут.
		return rect.width > 0 && rect.height > 0;
	});
}

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Ближайший элемент в заданном направлении.
 *
 * Метрика: расстояние вдоль направления плюс штраф за смещение по другой оси.
 * Штраф вдвое весомее — иначе «вправо» в ряду постеров перескакивает на соседний
 * ряд, если тот чуть ближе по прямой.
 */
function pick(from: HTMLElement, dir: Dir): HTMLElement | null {
	const a = from.getBoundingClientRect();
	const ax = a.left + a.width / 2;
	const ay = a.top + a.height / 2;

	let best: HTMLElement | null = null;
	let bestScore = Infinity;

	for (const el of candidates()) {
		if (el === from) continue;
		const b = el.getBoundingClientRect();
		const bx = b.left + b.width / 2;
		const by = b.top + b.height / 2;

		const dx = bx - ax;
		const dy = by - ay;

		let along: number;
		let across: number;

		switch (dir) {
			case 'left':
				if (dx > -8) continue;
				along = -dx;
				across = Math.abs(dy);
				break;
			case 'right':
				if (dx < 8) continue;
				along = dx;
				across = Math.abs(dy);
				break;
			case 'up':
				if (dy > -8) continue;
				along = -dy;
				across = Math.abs(dx);
				break;
			case 'down':
				if (dy < 8) continue;
				along = dy;
				across = Math.abs(dx);
				break;
		}

		const score = along + across * 2;
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}

	return best;
}

const KEY_TO_DIR: Record<string, Dir> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right'
};

/**
 * Ставит обработчик. Вызывается из корневого layout один раз.
 * Возвращает функцию снятия — её отдаёт $effect.
 */
export function installSpatialNav(): () => void {
	if (!browser || !isTvLike()) return () => {};

	// Пометка на корне: по ней CSS может усилить фокус-рамку именно на ТВ.
	document.documentElement.dataset.tvNav = 'true';

	const onKeydown = (e: KeyboardEvent) => {
		const dir = KEY_TO_DIR[e.key];
		if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;

		const active = document.activeElement as HTMLElement | null;

		// В поле ввода стрелки двигают курсор — не мешаем.
		if (
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement ||
			active?.isContentEditable
		) {
			return;
		}

		// Фокуса нет — ставим на первый элемент, дальше уже перемещаем.
		if (!active || active === document.body) {
			const first = candidates()[0];
			if (first) {
				e.preventDefault();
				first.focus();
			}
			return;
		}

		const next = pick(active, dir);
		if (!next) return;

		e.preventDefault();
		next.focus();
		// nearest по обеим осям: ряд доезжает по горизонтали, страница по вертикали,
		// и при этом ничего не «прыгает» через полэкрана.
		next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	};

	window.addEventListener('keydown', onKeydown);

	return () => {
		window.removeEventListener('keydown', onKeydown);
		delete document.documentElement.dataset.tvNav;
	};
}
