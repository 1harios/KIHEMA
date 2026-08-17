/**
 * Демо-режим.
 *
 * Позволяет поднять приложение без TMDB и Jellyfin: работает навигация, каталог,
 * страница тайтла и выбор озвучки. Видео при этом играется публичное — открытые
 * ролики Blender Foundation, они лежат под Creative Commons.
 *
 * Постеры рисуем как SVG прямо в data-URI: в демо не хочется ни ключей, ни
 * внешних картинок, а серые прямоугольники выглядят как поломка.
 */

import type { CatalogItem, MediaType, TitleDetails, Translation } from '$lib/types';

/** Детерминированный цвет из строки — один тайтл всегда одного цвета. */
function hashHue(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
	return h;
}

function svgPoster(title: string, year?: number, ratio: 'poster' | 'backdrop' = 'poster'): string {
	const hue = hashHue(title);
	const [w, h] = ratio === 'poster' ? [342, 513] : [1280, 720];
	const fontSize = ratio === 'poster' ? 26 : 64;

	// Переносим по словам, чтобы длинные названия не уезжали за край.
	const words = title.split(' ');
	const lines: string[] = [];
	let line = '';
	const maxChars = ratio === 'poster' ? 14 : 24;
	for (const word of words) {
		if ((line + ' ' + word).trim().length > maxChars) {
			if (line) lines.push(line.trim());
			line = word;
		} else {
			line = (line + ' ' + word).trim();
		}
	}
	if (line) lines.push(line);

	const escaped = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	const tspans = lines
		.slice(0, 4)
		.map(
			(l, i) =>
				`<tspan x="50%" dy="${i === 0 ? 0 : fontSize * 1.2}">${escaped(l)}</tspan>`
		)
		.join('');

	const startY = h / 2 - ((Math.min(lines.length, 4) - 1) * fontSize * 1.2) / 2;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 42% 22%)"/>
<stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 38% 10%)"/>
</linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<text x="50%" y="${startY}" fill="hsl(${hue} 30% 88%)" font-family="Inter,system-ui,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle">${tspans}</text>
${year ? `<text x="50%" y="${h - 28}" fill="hsl(${hue} 20% 62%)" font-family="Inter,system-ui,sans-serif" font-size="${fontSize * 0.55}" text-anchor="middle">${year}</text>` : ''}
</svg>`;

	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface DemoSeed {
	tmdbId: number;
	type: MediaType;
	title: string;
	year: number;
	rating: number;
	genres: string[];
	overview: string;
	/** Есть ли «в библиотеке» — в демо часть тайтлов намеренно отсутствует. */
	inLibrary: boolean;
	seasons?: number;
}

const SEEDS: DemoSeed[] = [
	{
		tmdbId: 652, type: 'movie', title: 'Троя', year: 2004, rating: 7.3,
		genres: ['Драма', 'Военный', 'Приключения'], inLibrary: true,
		overview: 'Ахиллес ведёт греческое войско под стены Трои, где его ждёт схватка с Гектором и собственная судьба.'
	},
	{
		tmdbId: 27205, type: 'movie', title: 'Начало', year: 2010, rating: 8.4,
		genres: ['Фантастика', 'Боевик', 'Триллер'], inLibrary: true,
		overview: 'Вор, умеющий проникать в чужие сны, получает шанс вернуть прежнюю жизнь — если сумеет внедрить идею.'
	},
	{
		tmdbId: 157336, type: 'movie', title: 'Интерстеллар', year: 2014, rating: 8.4,
		genres: ['Фантастика', 'Драма', 'Приключения'], inLibrary: true,
		overview: 'Группа исследователей уходит через червоточину, чтобы найти человечеству новый дом.'
	},
	{
		tmdbId: 155, type: 'movie', title: 'Тёмный рыцарь', year: 2008, rating: 8.5,
		genres: ['Боевик', 'Криминал', 'Драма'], inLibrary: true,
		overview: 'Бэтмен сталкивается с Джокером — противником, которому не нужны ни деньги, ни власть.'
	},
	{
		tmdbId: 603, type: 'movie', title: 'Матрица', year: 1999, rating: 8.2,
		genres: ['Фантастика', 'Боевик'], inLibrary: true,
		overview: 'Программист узнаёт, что привычный мир — симуляция, и присоединяется к сопротивлению.'
	},
	{
		tmdbId: 680, type: 'movie', title: 'Криминальное чтиво', year: 1994, rating: 8.5,
		genres: ['Криминал', 'Драма'], inLibrary: true,
		overview: 'Несколько историй из жизни бандитов Лос-Анджелеса, рассказанных не по порядку.'
	},
	{
		tmdbId: 13, type: 'movie', title: 'Форрест Гамп', year: 1994, rating: 8.5,
		genres: ['Драма', 'Мелодрама'], inLibrary: false,
		overview: 'Простодушный человек из Алабамы неожиданно оказывается в центре ключевых событий эпохи.'
	},
	{
		tmdbId: 550, type: 'movie', title: 'Бойцовский клуб', year: 1999, rating: 8.4,
		genres: ['Драма', 'Триллер'], inLibrary: false,
		overview: 'Офисный служащий и продавец мыла создают клуб, который выходит из-под контроля.'
	},
	{
		tmdbId: 244786, type: 'movie', title: 'Одержимость', year: 2014, rating: 8.4,
		genres: ['Драма', 'Музыка'], inLibrary: true,
		overview: 'Молодой барабанщик попадает к преподавателю, для которого цель оправдывает любые средства.'
	},
	{
		tmdbId: 496243, type: 'movie', title: 'Паразиты', year: 2019, rating: 8.5,
		genres: ['Драма', 'Триллер', 'Комедия'], inLibrary: false,
		overview: 'Бедная семья постепенно устраивается на работу к богатому семейству, скрывая родство.'
	},
	{
		tmdbId: 1396, type: 'show', title: 'Во все тяжкие', year: 2008, rating: 8.9,
		genres: ['Драма', 'Криминал'], inLibrary: true, seasons: 5,
		overview: 'Школьный учитель химии узнаёт о смертельном диагнозе и начинает производить метамфетамин.'
	},
	{
		tmdbId: 1399, type: 'show', title: 'Игра престолов', year: 2011, rating: 8.4,
		genres: ['Фэнтези', 'Драма'], inLibrary: true, seasons: 8,
		overview: 'Знатные дома борются за Железный трон, пока с севера надвигается древняя угроза.'
	},
	{
		tmdbId: 66732, type: 'show', title: 'Очень странные дела', year: 2016, rating: 8.6,
		genres: ['Фантастика', 'Ужасы', 'Драма'], inLibrary: true, seasons: 4,
		overview: 'В маленьком городке пропадает мальчик, а вместе с этим открывается дверь в другое измерение.'
	},
	{
		tmdbId: 94605, type: 'show', title: 'Аркейн', year: 2021, rating: 8.7,
		genres: ['Анимация', 'Фантастика', 'Драма'], inLibrary: true, seasons: 2,
		overview: 'Две сестры оказываются по разные стороны конфликта между роскошным городом и его подземельем.'
	},
	{
		tmdbId: 60059, type: 'show', title: 'Лучше звоните Солу', year: 2015, rating: 8.7,
		genres: ['Драма', 'Криминал'], inLibrary: false, seasons: 6,
		overview: 'История превращения мелкого адвоката Джимми Макгилла в дельца Сола Гудмана.'
	},
	{
		tmdbId: 87108, type: 'show', title: 'Чернобыль', year: 2019, rating: 8.7,
		genres: ['Драма', 'История'], inLibrary: true, seasons: 1,
		overview: 'Хроника аварии на Чернобыльской АЭС и работы тех, кто ликвидировал её последствия.'
	}
];

/** Названия жанров TMDB -> идентификаторы. Только те, что встречаются в демо. */
const GENRE_IDS: Record<string, number> = {
	Боевик: 28,
	Приключения: 12,
	Мультфильм: 16,
	Комедия: 35,
	Криминал: 80,
	Документальный: 99,
	Драма: 18,
	Семейный: 10751,
	Фэнтези: 14,
	Исторический: 36,
	Ужасы: 27,
	Музыка: 10402,
	Детектив: 9648,
	Романтика: 10749,
	Фантастика: 878,
	Триллер: 53,
	Военный: 10752,
	Вестерн: 37
};

const toItem = (s: DemoSeed): CatalogItem => ({
	tmdbId: s.tmdbId,
	type: s.type,
	title: s.title,
	year: s.year,
	overview: s.overview,
	poster: svgPoster(s.title, s.year, 'poster'),
	backdrop: svgPoster(s.title, s.year, 'backdrop'),
	rating: s.rating,
	genres: s.genres,
	/*
		Идентификаторы жанров восстанавливаем по названию. В демо их естественным
		образом нет, а без них интерфейс не может выбрать иконку жанра и ставит
		всем одну заглушку — то есть демо-режим врал бы о том, как выглядит сайт.
	*/
	genreIds: s.genres.map((n) => GENRE_IDS[n]).filter((id): id is number => Boolean(id)),
	inLibrary: s.inLibrary,
	jellyfinId: s.inLibrary ? `demo-${s.tmdbId}` : undefined
});

export const demoAll = (): CatalogItem[] => SEEDS.map(toItem);

export const demoByType = (type: MediaType): CatalogItem[] =>
	SEEDS.filter((s) => s.type === type).map(toItem);

export const demoTrending = (): CatalogItem[] =>
	[...SEEDS].sort((a, b) => b.rating - a.rating).slice(0, 10).map(toItem);

export const demoSearch = (q: string): CatalogItem[] => {
	const needle = q.trim().toLowerCase();
	if (!needle) return [];
	return SEEDS.filter((s) => s.title.toLowerCase().includes(needle)).map(toItem);
};

export function demoDetails(type: MediaType, tmdbId: number): TitleDetails | null {
	const seed = SEEDS.find((s) => s.tmdbId === tmdbId && s.type === type);
	if (!seed) return null;

	const base = toItem(seed);
	const others = SEEDS.filter((s) => s.tmdbId !== tmdbId && s.type === type).map(toItem);

	return {
		...base,
		tagline: undefined,
		runtimeSec: seed.type === 'movie' ? 7200 : 2700,
		runtimeMin: seed.type === 'movie' ? 120 : 45,
		countries: ['США'],
		genreRefs: [
			{ id: 18, name: 'Драма' },
			{ id: 878, name: 'Фантастика' }
		],
		/*
			Двенадцать актёров, а не четыре. Демо-режим существует, чтобы смотреть
			вёрстку, а четыре человека влезали в ряд целиком — то есть проверить
			прокрутку и стрелки ряда было невозможно, и именно там пряталась ошибка:
			ряд не двигался мышью вообще.
		*/
		cast: Array.from({ length: 12 }, (_, i) => ({
			name: `${i % 2 ? 'Актриса' : 'Актёр'} ${
				['Первый', 'Второй', 'Третий', 'Четвёртый', 'Пятый', 'Шестой',
				 'Седьмой', 'Восьмой', 'Девятый', 'Десятый', 'Одиннадцатый', 'Двенадцатый'][i]
			}`,
			character: i === 0 ? 'Главная роль' : 'Роль',
			photo: undefined
		})),
		crew: [
			{
				department: 'Режиссура',
				people: [{ name: 'Режиссёр Демонстрационный', job: 'Режиссёр' }]
			}
		],
		trailerKey: undefined,
		videos: [],
		seasons: Array.from({ length: seed.seasons ?? 0 }, (_, i) => ({
			seasonNumber: i + 1,
			name: `Сезон ${i + 1}`,
			episodeCount: 8,
			poster: base.poster,
			inLibraryCount: seed.inLibrary ? 8 : 0
		})),
		similar: others.slice(0, 8),
		recommendations: others.slice(8, 16),
		keywords: [],
		facts: { companies: [], networks: [] },
		/*
			Галерея в демо не пустая намеренно. Демо-режим существует, чтобы смотреть
			вёрстку без ключа TMDB, — а блок галереи и просмотрщик картинок в пустом
			виде просто не отрисовываются, то есть проверить их было нельзя. Кадры
			здесь — заглушки того же соотношения сторон, что настоящие: 16:9 и 2:3.
		*/
		gallery: {
			backdrops: Array.from({ length: 5 }, (_, i) => {
				const src = svgPoster(`${base.title} — кадр ${i + 1}`, base.year, 'backdrop');
				return { url: src, full: src };
			}),
			posters: Array.from({ length: 3 }, (_, i) => {
				const src = svgPoster(`${base.title} — постер ${i + 1}`, base.year);
				return { url: src, full: src };
			})
		},
		reviews: [],
		episodeGroups: []
	};
}

export function demoEpisodes(tmdbId: number, season: number) {
	const seed = SEEDS.find((s) => s.tmdbId === tmdbId);
	return Array.from({ length: 8 }, (_, i) => ({
		seasonNumber: season,
		episodeNumber: i + 1,
		name: `Серия ${i + 1}`,
		overview: 'Описание серии появится, когда будет подключён TMDB.',
		still: undefined,
		runtimeSec: 2700,
		airDate: undefined,
		inLibrary: Boolean(seed?.inLibrary),
		jellyfinId: seed?.inLibrary ? `demo-${tmdbId}-s${season}e${i + 1}` : undefined
	}));
}

/**
 * Демо-озвучки. Набор намеренно разнородный: так видно, что подпись собирается
 * из студии, кодека и числа каналов, а не берётся одной строкой.
 */
export const DEMO_TRANSLATIONS: Translation[] = [
	{ id: 'a1', audioStreamIndex: 1, label: 'Дубляж · Мосфильм · EAC3 · 5.1', language: 'rus', codec: 'eac3', channels: 6, isDefault: true },
	{ id: 'a2', audioStreamIndex: 2, label: 'Многоголосый · Кубик в Кубе · AAC · Стерео', language: 'rus', codec: 'aac', channels: 2, isDefault: false },
	{ id: 'a3', audioStreamIndex: 3, label: 'Авторский · Гоблин · AC3 · Стерео', language: 'rus', codec: 'ac3', channels: 2, isDefault: false },
	{ id: 'a4', audioStreamIndex: 4, label: 'Английский · DTS · 5.1', language: 'eng', codec: 'dts', channels: 6, isDefault: false }
];

/** Открытые ролики Blender Foundation — Creative Commons, играть можно свободно. */
export const DEMO_STREAMS = [
	'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
	'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
];

export const DEMO_SEGMENTS = [
	{ type: 'Intro' as const, startSec: 8, endSec: 38 },
	{ type: 'Outro' as const, startSec: 560, endSec: 600 }
];
