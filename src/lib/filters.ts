/**
 * Работа с фильтрами на стороне клиента.
 *
 * Единственный источник правды по фильтрам — query-строка (см. catalog-loader.ts
 * на сервере). Здесь только сборка новых URL из текущего. Все элементы фильтров
 * благодаря этому остаются ссылками: работают без JS, открываются в новой вкладке,
 * корректно ходят по истории.
 */

import type { DiscoverFilters } from './types';

/** Короткие ключи query — те же, что разбирает сервер. */
export const KEYS = {
	genres: 'g',
	/**
	 * Исключённые жанры. В интерфейсе фильтров их больше нет — ключ остался
	 * потому, что его ставит подбор по настроению (см. server/moods.ts): «лёгкое»
	 * само исключает хоррор. Здесь он нужен, чтобы «сбросить всё» его вычищало.
	 */
	excludeGenres: 'xg',
	matchAll: 'all',
	keywords: 'kw',
	yearFrom: 'from',
	yearTo: 'to',
	runtimeFrom: 'rtf',
	runtimeTo: 'rtt',
	rating: 'rating',
	votes: 'votes',
	country: 'country',
	language: 'lang',
	providers: 'prov',
	monetization: 'mon',
	networks: 'net',
	status: 'status',
	sort: 'sort',
	page: 'page',
	library: 'lib'
} as const;

/** Все ключи фильтров — для «сбросить всё». */
const FILTER_KEYS: string[] = Object.values(KEYS).filter((k) => k !== KEYS.sort);

/**
 * Меняет параметры и всегда сбрасывает страницу.
 * Забыть сбросить page — классическая ошибка: пользователь на 7-й странице
 * меняет жанр и попадает на 7-ю страницу нового результата, часто пустую.
 */
export function buildUrl(
	url: URL,
	changes: Record<string, string | number | null | undefined>
): string {
	const p = new URLSearchParams(url.searchParams);

	for (const [key, value] of Object.entries(changes)) {
		if (value === null || value === undefined || value === '') p.delete(key);
		else p.set(key, String(value));
	}
	p.delete(KEYS.page);

	const qs = p.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** Ссылка на конкретную страницу — здесь page как раз сохраняем. */
export function pageUrl(url: URL, page: number): string {
	const p = new URLSearchParams(url.searchParams);
	if (page <= 1) p.delete(KEYS.page);
	else p.set(KEYS.page, String(page));
	const qs = p.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/** Текущий список числовых значений по ключу. */
export function readList(url: URL, key: string): number[] {
	const raw = url.searchParams.get(key);
	if (!raw) return [];
	return raw
		.split(',')
		.map((x) => Number.parseInt(x, 10))
		.filter((n) => Number.isFinite(n));
}

export function readStrList(url: URL, key: string): string[] {
	const raw = url.searchParams.get(key);
	return raw ? raw.split(',').filter(Boolean) : [];
}

/** Добавляет или убирает значение из списка. */
export function toggleInList(url: URL, key: string, value: number | string): string {
	const raw = url.searchParams.get(key);
	const list = raw ? raw.split(',').filter(Boolean) : [];
	const str = String(value);
	const next = list.includes(str) ? list.filter((v) => v !== str) : [...list, str];
	return buildUrl(url, { [key]: next.length ? next.join(',') : null });
}

/**
 * Выбран жанр или нет.
 *
 * Раньше переключатель был трёхпозиционным: нужен -> не нужен -> всё равно, с
 * отдельным списком исключений. Убрано по требованию: состояние «не нужен»
 * приходилось объяснять подписью, потому что второе нажатие давало результат,
 * которого никто не ждал, — а выигрыш («фантастика, но не хоррор») нужен редко.
 * Теперь нажатие добавляет жанр, повторное убирает, выбрать можно сколько угодно.
 */
export const isGenreOn = (url: URL, id: number): boolean =>
	readList(url, KEYS.genres).includes(id);

export const toggleGenre = (url: URL, id: number): string =>
	toggleInList(url, KEYS.genres, id);

/**
 * Снимает один активный фильтр по ключу из describeActive.
 *
 * Нужно, чтобы чипсы «активно» стали кликабельными: сейчас единственный выход —
 * «сбросить всё», а это грубо, когда из шести условий мешает одно.
 */
export function removeUrl(url: URL, key: string): string {
	// Составные ключи вида «g:28» — убрать один жанр из списка.
	if (key.includes(':')) {
		const [listKey, raw] = key.split(':');
		const id = Number.parseInt(raw, 10);
		const rest = readList(url, listKey).filter((x) => x !== id);
		return buildUrl(url, { [listKey]: rest.length ? rest.join(',') : null });
	}

	switch (key) {
		case 'years':
			return buildUrl(url, { [KEYS.yearFrom]: null, [KEYS.yearTo]: null });
		case 'runtime':
			return buildUrl(url, { [KEYS.runtimeFrom]: null, [KEYS.runtimeTo]: null });
		case 'rating':
			return buildUrl(url, { [KEYS.rating]: null });
		case 'votes':
			return buildUrl(url, { [KEYS.votes]: null });
		case 'country':
			return buildUrl(url, { [KEYS.country]: null });
		case 'lang':
			return buildUrl(url, { [KEYS.language]: null });
		case 'mon':
			return buildUrl(url, { [KEYS.monetization]: null });
		case 'prov':
			return buildUrl(url, { [KEYS.providers]: null });
		case 'status':
			return buildUrl(url, { [KEYS.status]: null });
		default:
			return buildUrl(url, { [key]: null });
	}
}

export function resetUrl(url: URL): string {
	const p = new URLSearchParams(url.searchParams);
	for (const key of FILTER_KEYS) p.delete(key);
	const qs = p.toString();
	return qs ? `${url.pathname}?${qs}` : url.pathname;
}

/* ------------------------------ готовые наборы ----------------------------- */

const CURRENT_YEAR = new Date().getFullYear();

/** Десятилетия от текущего вниз — быстрее, чем набирать годы руками. */
export const DECADES = (() => {
	const start = Math.floor(CURRENT_YEAR / 10) * 10;
	const out: { label: string; from: number; to: number }[] = [];
	for (let d = start; d >= 1950; d -= 10) {
		out.push({ label: `${String(d).slice(2)}-е`, from: d, to: d + 9 });
	}
	return out;
})();

export const RUNTIME_BUCKETS = [
	{ label: 'до 1,5 ч', from: undefined, to: 90 },
	{ label: '1,5–2 ч', from: 90, to: 120 },
	{ label: '2–2,5 ч', from: 120, to: 150 },
	{ label: 'больше 2,5 ч', from: 150, to: undefined }
] as const;

export const RATING_STEPS = [6, 7, 7.5, 8] as const;

/** Порог голосов: словами, потому что «300» само по себе ничего не говорит. */
export const VOTE_STEPS = [
	{ value: 100, label: 'есть отзывы' },
	{ value: 1000, label: 'известное' },
	{ value: 5000, label: 'очень известное' }
] as const;

export const MONETIZATION = [
	{ value: 'flatrate', label: 'по подписке' },
	{ value: 'free', label: 'бесплатно' },
	{ value: 'ads', label: 'с рекламой' },
	{ value: 'rent', label: 'аренда' },
	{ value: 'buy', label: 'покупка' }
] as const;

export const LANGUAGES = [
	{ code: 'en', name: 'английский' },
	{ code: 'ru', name: 'русский' },
	{ code: 'ko', name: 'корейский' },
	{ code: 'ja', name: 'японский' },
	{ code: 'fr', name: 'французский' },
	{ code: 'es', name: 'испанский' },
	{ code: 'de', name: 'немецкий' },
	{ code: 'it', name: 'итальянский' },
	{ code: 'zh', name: 'китайский' },
	{ code: 'hi', name: 'хинди' },
	{ code: 'sv', name: 'шведский' },
	{ code: 'da', name: 'датский' }
] as const;

/** Человеческое описание применённых фильтров — для чипсов «активно». */
export function describeActive(
	filters: DiscoverFilters,
	genreNames: Map<number, string>
): { key: string; label: string }[] {
	const out: { key: string; label: string }[] = [];

	for (const id of filters.genres ?? []) {
		out.push({ key: `${KEYS.genres}:${id}`, label: genreNames.get(id) ?? `Жанр ${id}` });
	}
	if (filters.yearFrom || filters.yearTo) {
		out.push({
			key: 'years',
			label:
				filters.yearFrom && filters.yearTo
					? `${filters.yearFrom}–${filters.yearTo}`
					: filters.yearFrom
						? `с ${filters.yearFrom}`
						: `до ${filters.yearTo}`
		});
	}
	if (filters.runtimeFrom || filters.runtimeTo) {
		out.push({
			key: 'runtime',
			label:
				filters.runtimeFrom && filters.runtimeTo
					? `${filters.runtimeFrom}–${filters.runtimeTo} мин`
					: filters.runtimeFrom
						? `от ${filters.runtimeFrom} мин`
						: `до ${filters.runtimeTo} мин`
		});
	}
	if (filters.minRating) out.push({ key: 'rating', label: `рейтинг ${filters.minRating}+` });
	if (filters.minVotes) {
		const step = VOTE_STEPS.find((s) => s.value === filters.minVotes);
		out.push({ key: 'votes', label: step?.label ?? `${filters.minVotes}+ оценок` });
	}
	if (filters.country) out.push({ key: 'country', label: `страна: ${filters.country}` });
	if (filters.language) {
		const lang = LANGUAGES.find((l) => l.code === filters.language);
		out.push({ key: 'lang', label: lang?.name ?? filters.language });
	}
	if (filters.providers?.length) {
		out.push({ key: 'prov', label: `сервисов: ${filters.providers.length}` });
	}
	if (filters.monetization?.length) {
		const names = filters.monetization
			.map((m) => MONETIZATION.find((x) => x.value === m)?.label ?? m)
			.join(', ');
		out.push({ key: 'mon', label: names });
	}
	if (filters.showStatus?.length) {
		out.push({ key: 'status', label: `статусов: ${filters.showStatus.length}` });
	}

	return out;
}
