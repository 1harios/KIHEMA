/**
 * Пресеты настроения для подбора.
 *
 * Почему не «жанры»: жанр отвечает на вопрос «что это», настроение — «чего я
 * хочу». «Фантастика» это и «Интерстеллар», и «Шерлок Гномс». Поэтому пресет —
 * это комбинация жанров, порога качества, длительности и ключевых слов TMDB.
 *
 * Ключевые слова заданы НАЗВАНИЯМИ, а не ID, и разрешаются через /search/keyword
 * при первом обращении. Прибитые numeric-ID ключевых слов — классический способ
 * получить молча пустую выдачу через полгода: их никто не гарантирует, а
 * проверить глазами в коде нельзя. ID жанров, наоборот, документированы и
 * стабильны — их держим числами.
 *
 * Если разрешение ключевых слов не удалось, пресет всё равно работает: жанры и
 * пороги на месте, выдача просто менее точная.
 */

import type { MediaType, MoodPreset } from '$lib/types';
import { tmdb } from './config';

/* --------------------------- ID жанров (документированы) ------------------ */

export const MOVIE_GENRE = {
	action: 28,
	adventure: 12,
	animation: 16,
	comedy: 35,
	crime: 80,
	documentary: 99,
	drama: 18,
	family: 10751,
	fantasy: 14,
	history: 36,
	horror: 27,
	music: 10402,
	mystery: 9648,
	romance: 10749,
	sciFi: 878,
	thriller: 53,
	war: 10752,
	western: 37
} as const;

export const TV_GENRE = {
	actionAdventure: 10759,
	animation: 16,
	comedy: 35,
	crime: 80,
	documentary: 99,
	drama: 18,
	family: 10751,
	kids: 10762,
	mystery: 9648,
	reality: 10764,
	sciFiFantasy: 10765,
	soap: 10766,
	warPolitics: 10768,
	western: 37
} as const;

/* ------------------------------- сами пресеты ------------------------------ */

/**
 * Ключевые слова пишем по-английски: индекс ключевых слов TMDB англоязычный,
 * русский запрос в /search/keyword почти всегда возвращает пусто.
 */
interface MoodSeed {
	id: string;
	label: string;
	hint: string;
	/** Эмодзи-глиф на карточке. Не декор: помогает различать карточки взглядом. */
	glyph: string;
	keywordNames: string[];
	movieGenres?: number[];
	tvGenres?: number[];
	excludeMovieGenres?: number[];
	excludeTvGenres?: number[];
	/** Дополнительные ограничения, которые делают пресет осмысленным. */
	minRating?: number;
	minVotes?: number;
	runtimeFrom?: number;
	runtimeTo?: number;
	yearFrom?: number;
}

const SEEDS: MoodSeed[] = [
	{
		id: 'mindbender',
		label: 'Сломать голову',
		hint: 'Нелинейный сюжет, временные петли, финал с поворотом',
		glyph: '🌀',
		keywordNames: ['time loop', 'nonlinear timeline', 'twist ending', 'psychological thriller'],
		movieGenres: [MOVIE_GENRE.mystery, MOVIE_GENRE.sciFi, MOVIE_GENRE.thriller],
		tvGenres: [TV_GENRE.mystery, TV_GENRE.sciFiFantasy],
		minRating: 6.8,
		minVotes: 400
	},
	{
		id: 'adrenaline',
		label: 'Адреналин',
		hint: 'Погони, ограбления, ни минуты покоя',
		glyph: '💥',
		keywordNames: ['heist', 'car chase', 'one man army', 'assassin'],
		movieGenres: [MOVIE_GENRE.action, MOVIE_GENRE.thriller, MOVIE_GENRE.crime],
		tvGenres: [TV_GENRE.actionAdventure, TV_GENRE.crime],
		minVotes: 300
	},
	{
		id: 'cozy',
		label: 'Тёплый вечер',
		hint: 'Уютное, доброе, без тяжёлых сцен',
		glyph: '🕯️',
		keywordNames: ['friendship', 'small town', 'coming of age', 'feel good'],
		movieGenres: [MOVIE_GENRE.comedy, MOVIE_GENRE.family, MOVIE_GENRE.romance],
		tvGenres: [TV_GENRE.comedy, TV_GENRE.family],
		excludeMovieGenres: [MOVIE_GENRE.horror, MOVIE_GENRE.war],
		excludeTvGenres: [TV_GENRE.warPolitics],
		minRating: 6.4
	},
	{
		id: 'darkness',
		label: 'В темноте',
		hint: 'Хоррор, саспенс, тревожная атмосфера',
		glyph: '🕷️',
		keywordNames: ['haunted house', 'supernatural', 'slasher', 'cult'],
		movieGenres: [MOVIE_GENRE.horror, MOVIE_GENRE.thriller],
		tvGenres: [TV_GENRE.mystery, TV_GENRE.drama],
		minVotes: 200
	},
	{
		id: 'aftermath',
		label: 'После конца',
		hint: 'Постапокалипсис, антиутопии, выживание',
		glyph: '☢️',
		keywordNames: ['post-apocalyptic future', 'dystopia', 'survival', 'pandemic'],
		movieGenres: [MOVIE_GENRE.sciFi, MOVIE_GENRE.action, MOVIE_GENRE.drama],
		tvGenres: [TV_GENRE.sciFiFantasy, TV_GENRE.drama],
		minVotes: 250
	},
	{
		id: 'true',
		label: 'Так было',
		hint: 'Реальные события, биографии, документальное',
		glyph: '📰',
		keywordNames: ['based on true story', 'biography', 'true crime', 'historical figure'],
		movieGenres: [MOVIE_GENRE.drama, MOVIE_GENRE.history, MOVIE_GENRE.documentary],
		tvGenres: [TV_GENRE.documentary, TV_GENRE.drama],
		minRating: 6.5,
		minVotes: 150
	},
	{
		id: 'laugh',
		label: 'Просто поржать',
		hint: 'Комедия без второго дна',
		glyph: '🃏',
		keywordNames: ['buddy comedy', 'parody', 'stand-up comedy', 'satire'],
		movieGenres: [MOVIE_GENRE.comedy],
		tvGenres: [TV_GENRE.comedy],
		excludeMovieGenres: [MOVIE_GENRE.horror],
		minVotes: 150
	},
	{
		id: 'tears',
		label: 'Поплакать',
		hint: 'Сильная драма, которая не отпускает',
		glyph: '🌧️',
		keywordNames: ['tragedy', 'terminal illness', 'loss of loved one', 'melodrama'],
		movieGenres: [MOVIE_GENRE.drama, MOVIE_GENRE.romance],
		tvGenres: [TV_GENRE.drama],
		minRating: 7,
		minVotes: 300
	},
	{
		id: 'epic',
		label: 'Большое кино',
		hint: 'Масштаб, миры, три часа в кресле',
		glyph: '🏔️',
		keywordNames: ['epic', 'sword and sorcery', 'space opera', 'medieval'],
		movieGenres: [MOVIE_GENRE.adventure, MOVIE_GENRE.fantasy, MOVIE_GENRE.sciFi],
		tvGenres: [TV_GENRE.sciFiFantasy, TV_GENRE.actionAdventure],
		runtimeFrom: 130,
		minRating: 6.8,
		minVotes: 400
	},
	{
		id: 'short',
		label: 'Полтора часа',
		hint: 'Уложиться до полуночи',
		glyph: '⏱️',
		keywordNames: [],
		runtimeTo: 100,
		minRating: 6.5,
		minVotes: 200
	},
	{
		id: 'anime',
		label: 'Аниме',
		hint: 'Японская анимация',
		glyph: '🌸',
		keywordNames: ['anime', 'based on manga'],
		movieGenres: [MOVIE_GENRE.animation],
		tvGenres: [TV_GENRE.animation],
		minVotes: 100
	},
	{
		id: 'fresh',
		label: 'Свежее',
		hint: 'Вышло за последние два года',
		glyph: '✦',
		keywordNames: [],
		yearFrom: new Date().getFullYear() - 2,
		minRating: 6.3,
		minVotes: 100
	}
];

/** То, что уходит в браузер: без английских служебных полей. */
export const MOOD_CARDS = SEEDS.map(({ id, label, hint, glyph }) => ({ id, label, hint, glyph }));

/* ---------------------------- разрешение ключевых слов --------------------- */

/** Кеш «название -> id». Ключевые слова не меняются, держим на весь процесс. */
const keywordIds = new Map<string, number | null>();

async function resolveKeyword(name: string): Promise<number | null> {
	if (keywordIds.has(name)) return keywordIds.get(name) ?? null;
	if (!tmdb) return null;

	const found = await tmdb.searchKeywords(name).catch(() => []);
	// Только точное совпадение: «heist» не должен превратиться в «heist movie».
	const exact = found.find((k) => k.name.toLowerCase() === name.toLowerCase()) ?? found[0];
	const id = exact?.id ?? null;
	keywordIds.set(name, id);
	return id;
}

/**
 * Собирает фильтры Discover из выбранных настроений.
 * Ключевые слова объединяются по OR: «или петля, или твист», иначе на пересечении
 * двух-трёх редких слов выдача схлопывается в ноль.
 */
export async function moodFilters(
	ids: string[],
	type: MediaType
): Promise<{
	keywords: number[];
	genres: number[];
	excludeGenres: number[];
	minRating?: number;
	minVotes?: number;
	runtimeFrom?: number;
	runtimeTo?: number;
	yearFrom?: number;
}> {
	const chosen = SEEDS.filter((s) => ids.includes(s.id));
	if (!chosen.length) {
		return { keywords: [], genres: [], excludeGenres: [] };
	}

	const names = [...new Set(chosen.flatMap((s) => s.keywordNames))];
	const resolved = await Promise.all(names.map(resolveKeyword));

	const genres = new Set<number>();
	const excludeGenres = new Set<number>();
	for (const s of chosen) {
		for (const g of (type === 'movie' ? s.movieGenres : s.tvGenres) ?? []) genres.add(g);
		for (const g of (type === 'movie' ? s.excludeMovieGenres : s.excludeTvGenres) ?? [])
			excludeGenres.add(g);
	}
	// Жанр не может быть одновременно нужным и нежелательным: при смешивании
	// «Тёплый вечер» + «В темноте» побеждает включение.
	for (const g of genres) excludeGenres.delete(g);

	// При смешивании пресетов берём самое мягкое ограничение — иначе пересечение
	// «Поплакать» и «Полтора часа» не даёт ничего.
	const min = <T>(vals: (T | undefined)[]) => {
		const list = vals.filter((v): v is T => v !== undefined);
		return list.length ? (list.sort()[0] as T) : undefined;
	};

	return {
		keywords: resolved.filter((id): id is number => id !== null),
		genres: [...genres],
		excludeGenres: [...excludeGenres],
		minRating: min(chosen.map((s) => s.minRating)),
		minVotes: min(chosen.map((s) => s.minVotes)),
		runtimeFrom: min(chosen.map((s) => s.runtimeFrom)),
		runtimeTo: chosen.some((s) => s.runtimeTo)
			? Math.max(...chosen.filter((s) => s.runtimeTo).map((s) => s.runtimeTo!))
			: undefined,
		yearFrom: min(chosen.map((s) => s.yearFrom))
	};
}

export const MOOD_IDS = SEEDS.map((s) => s.id);

export type { MoodPreset };
