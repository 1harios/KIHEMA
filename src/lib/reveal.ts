/**
 * Появление блока при прокрутке.
 *
 * Два решения, которые важнее самой анимации:
 *
 * 1. Прячет элемент само действие, а не разметка. Если скрывать через класс в
 *    HTML, то при выключенном или упавшем JS страница остаётся пустой — контент
 *    есть в исходнике, но не виден. Здесь наоборот: серверная разметка всегда
 *    видима, а анимацию добавляет клиент, если может.
 *
 * 2. Блоки, которые видны на первом экране, не анимируются вообще. Иначе на
 *    загрузке получается «моргание»: элемент отрисовался, действие его спрятало,
 *    наблюдатель вернул обратно. Анимировать то, что пользователь уже прочитал,
 *    смысла нет — эффект нужен только для того, что приезжает из-за сгиба.
 */

import type { Action } from 'svelte/action';

interface RevealOptions {
	/** Задержка в мс — для лестницы соседних блоков. */
	delay?: number;
	/** Насколько блок должен войти в кадр (0..1). */
	threshold?: number;
}

/** Один наблюдатель на все блоки: по одному на элемент — заметный расход. */
let observer: IntersectionObserver | null = null;
const delays = new WeakMap<Element, number>();

function ensureObserver(): IntersectionObserver {
	observer ??= new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				const delay = delays.get(el) ?? 0;
				if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
				el.classList.add('reveal-in');
				// Показали — больше не следим: повторное появление при прокрутке
				// назад выглядит как дефект, а не как эффект.
				observer?.unobserve(el);
				delays.delete(el);
			}
		},
		{
			// Начинаем чуть раньше, чем блок покажется: к моменту, когда край
			// доедет до кадра, анимация уже идёт и не выглядит запоздавшей.
			rootMargin: '0px 0px -8% 0px',
			threshold: 0.05
		}
	);
	return observer;
}

export const reveal: Action<HTMLElement, RevealOptions | undefined> = (node, options) => {
	// Уважаем системную настройку и отсутствие поддержки — просто ничего не делаем.
	if (
		typeof IntersectionObserver === 'undefined' ||
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		return;
	}

	// Уже в кадре на момент монтирования — оставляем как есть.
	const rect = node.getBoundingClientRect();
	if (rect.top < window.innerHeight * 0.9) return;

	if (options?.delay) delays.set(node, options.delay);
	node.classList.add('reveal');
	ensureObserver().observe(node);

	return {
		destroy() {
			observer?.unobserve(node);
			delays.delete(node);
		}
	};
};
