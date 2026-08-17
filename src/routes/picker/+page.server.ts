import type { PageServerLoad } from './$types';
import { discover, getGenres, getProviders } from '$lib/server/catalog';
import { MOOD_CARDS, moodFilters } from '$lib/server/moods';
import { RUNTIME_BUCKETS } from '$lib/filters';
import type { DiscoverFilters, MediaType } from '$lib/types';

/**
 * Подбор фильма.
 *
 * Состояние мастера целиком в URL: шаг, тип, настроения, жанры, годы, планка,
 * сервисы. Из-за этого работают кнопка «назад», обновление страницы и пересылка
 * результата ссылкой — то есть ровно то, чего не даёт мастер на локальном
 * состоянии компонента.
 */

const nums = (v: string | null): number[] =>
	v
		? v
				.split(',')
				.map((x) => Number.parseInt(x, 10))
				.filter((n) => Number.isFinite(n))
		: [];

const num = (v: string | null): number | undefined => {
	const n = Number.parseInt(v ?? '', 10);
	return Number.isFinite(n) ? n : undefined;
};

const strs = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);

export const load: PageServerLoad = async ({ url }) => {
	const p = url.searchParams;

	const type: MediaType = p.get('type') === 'show' ? 'show' : 'movie';
	const step = Math.min(Math.max(num(p.get('step')) ?? 1, 1), 5);
	const isResult = p.get('step') === 'result';

	const state = {
		type,
		moods: strs(p.get('mood')),
		genres: nums(p.get('g')),
		excludeGenres: nums(p.get('xg')),
		yearFrom: num(p.get('from')),
		yearTo: num(p.get('to')),
		runtime: num(p.get('rt')),
		minRating: p.get('rating') ? Number.parseFloat(p.get('rating')!) : undefined,
		providers: nums(p.get('prov')),
		monetization: strs(p.get('mon'))
	};

	// Справочники нужны на всех шагах: жанры на втором, сервисы на пятом.
	const [genres, providers] = await Promise.all([getGenres(type), getProviders(type)]);

	if (!isResult) {
		return { step, isResult: false as const, state, moods: MOOD_CARDS, genres, providers };
	}

	/* ------------------------------ результат ------------------------------ */

	const mood = await moodFilters(state.moods, type);
	const bucket = state.runtime !== undefined ? RUNTIME_BUCKETS[state.runtime] : undefined;

	// Выбор пользователя приоритетнее пресета: если жанры указаны явно, настроение
	// добавляет только ключевые слова, но не подмешивает свои жанры.
	const genresChosen = state.genres.length > 0;

	const filters: DiscoverFilters = {
		genres: genresChosen ? state.genres : mood.genres,
		excludeGenres: [...new Set([...state.excludeGenres, ...mood.excludeGenres])],
		keywords: mood.keywords,
		yearFrom: state.yearFrom ?? mood.yearFrom,
		yearTo: state.yearTo,
		runtimeFrom: bucket?.from ?? mood.runtimeFrom,
		runtimeTo: bucket?.to ?? mood.runtimeTo,
		minRating: state.minRating ?? mood.minRating,
		minVotes: mood.minVotes,
		providers: state.providers.length ? state.providers : undefined,
		monetization: state.monetization.length ? state.monetization : undefined,
		sortBy: 'popularity.desc'
	};

	// Первый запрос — чтобы узнать объём выдачи.
	let result = await discover(type, filters);

	/**
	 * Разнообразие. Сортировка по популярности всегда отдаёт одну и ту же двадцатку,
	 * и «ещё вариант» быстро упирается в те же тайтлы. Поэтому при широкой выдаче
	 * берём случайную страницу из первых десяти: результат остаётся релевантным
	 * (это всё ещё топ популярности), но повторный подбор даёт другое.
	 */
	const seed = num(p.get('seed'));
	if (result.totalPages > 1) {
		const maxPage = Math.min(result.totalPages, 10);
		const pageNo = seed ? ((seed - 1) % maxPage) + 1 : 1 + Math.floor(Math.random() * maxPage);
		if (pageNo !== 1) {
			const alt = await discover(type, { ...filters, page: pageNo });
			if (alt.items.length) result = { ...alt, totalResults: result.totalResults };
		}
	}

	/**
	 * Если пересечение условий дало пусто — ослабляем по одному, начиная с самого
	 * узкого. Молча пустой экран после пяти шагов мастера — худший исход: человек
	 * не понимает, виноват он или сайт.
	 */
	const relaxed: string[] = [];
	if (!result.items.length) {
		const attempts: { label: string; patch: Partial<DiscoverFilters> }[] = [
			{ label: 'ключевые слова настроения', patch: { keywords: undefined } },
			{ label: 'длительность', patch: { runtimeFrom: undefined, runtimeTo: undefined } },
			{ label: 'сервисы', patch: { providers: undefined, monetization: undefined } },
			{ label: 'планку рейтинга', patch: { minRating: undefined, minVotes: undefined } },
			{ label: 'годы', patch: { yearFrom: undefined, yearTo: undefined } }
		];

		let current = { ...filters };
		for (const attempt of attempts) {
			current = { ...current, ...attempt.patch };
			relaxed.push(attempt.label);
			result = await discover(type, current);
			if (result.items.length) break;
		}
	}

	return {
		step: 5,
		isResult: true as const,
		state,
		moods: MOOD_CARDS,
		genres,
		providers,
		pool: result.items,
		totalResults: result.totalResults,
		/** Что пришлось ослабить, чтобы найти хоть что-то. */
		relaxed
	};
};
