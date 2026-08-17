/**
 * Проверка контраста текста.
 *
 * Претензия была конкретной: серый текст на фотографии. Чинилось это не
 * подкруткой оттенка, а переносом длинного текста с кадра на плотную подложку —
 * значит и проверять надо два разных утверждения.
 *
 * 1. На кадре не осталось длинных текстов. Абзац на фотографии нечитаем при
 *    любом цвете: у каждого тайтла кадр свой, и светлый участок найдётся всегда.
 *    Короткие подписи допустимы, но должны быть почти белыми либо лежать на
 *    собственной тёмной подложке.
 *
 * 2. Там, где текст лежит на подложке, отношение контраста считается точно —
 *    цвета известны, сэмплировать пиксели не нужно. Порог AA для обычного
 *    текста 4.5:1, для крупного 3:1.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];

const check = (ok, what) => {
	if (!ok) problems.push(what);
	console.log(`${ok ? 'ок  ' : 'СБОЙ'} ${what}`);
};

await page.goto(`${BASE}/movie/27205-nachalo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
	/*
		Цвет разбираем не регулярным выражением, а холстом.

		Tailwind 4 задаёт прозрачность через color-mix, и getComputedStyle отдаёт
		в Chromium что-то вида «oklab(0.9 0.01 -0.02 / 0.85)». Разбор чисел из
		такой строки даёт мусор — первая версия этой проверки именно так и
		«нашла» контраст 1.02:1 у нормального текста. Холст же приводит любой
		CSS-цвет к sRGB, потому что рисует его по-настоящему.
	*/
	const cv = document.createElement('canvas');
	cv.width = cv.height = 1;
	const ctx = cv.getContext('2d', { willReadFrequently: true });

	const parse = (c) => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#000';
		ctx.fillStyle = c;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return { r, g, b, a: a / 255 };
	};
	const over = (fg, bg) => ({
		r: fg.r * fg.a + bg.r * (1 - fg.a),
		g: fg.g * fg.a + bg.g * (1 - fg.a),
		b: fg.b * fg.a + bg.b * (1 - fg.a),
		a: 1
	});
	const lum = ({ r, g, b }) => {
		const f = (v) => {
			const s = v / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	};
	const ratio = (a, b) => {
		const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	};

	/** Эффективный фон элемента: складываем подложки предков до непрозрачной. */
	const bgOf = (el) => {
		const stack = [];
		let node = el;
		while (node && node !== document.documentElement) {
			const bg = parse(getComputedStyle(node).backgroundColor);
			if (bg.a > 0) stack.push(bg);
			if (bg.a >= 0.999) break;
			node = node.parentElement;
		}
		let acc = { r: 8, g: 9, b: 11, a: 1 }; // --c-bg как дно
		for (const bg of stack.reverse()) acc = over(bg, acc);
		return acc;
	};

	const hero = document.querySelector('main section');
	const heroTexts = [];
	if (hero) {
		for (const el of hero.querySelectorAll('p, span, h1, dd, dt, a')) {
			const text = (el.textContent ?? '').trim();
			if (!text || el.children.length) continue;
			const cs = getComputedStyle(el);
			const color = parse(cs.color);
			const bg = bgOf(el);
			heroTexts.push({
				text: text.slice(0, 40),
				len: text.length,
				lum: Math.round(lum(over(color, bg)) * 100) / 100,
				ownBg: parse(cs.backgroundColor).a > 0.2 || parse(getComputedStyle(el.parentElement).backgroundColor).a > 0.2
			});
		}
	}

	// Описание под кадром: цвета известны, считаем точно.
	const about = [...document.querySelectorAll('section p')].find(
		(p) => (p.textContent ?? '').length > 60 && !hero?.contains(p)
	);
	const aboutInfo = about
		? (() => {
				const cs = getComputedStyle(about);
				const bg = bgOf(about);
				const fg = over(parse(cs.color), bg);
				return { ratio: Math.round(ratio(fg, bg) * 100) / 100, size: cs.fontSize };
			})()
		: null;

	return { heroTexts, aboutInfo };
});

/* --- на кадре нет длинных текстов --- */
const longOnHero = report.heroTexts.filter((t) => t.len > 120);
check(
	longOnHero.length === 0,
	longOnHero.length
		? `на кадре остался длинный текст: «${longOnHero[0].text}…» (${longOnHero[0].len} символов)`
		: 'на кадре нет длинных текстов — описание перенесено на подложку'
);

/* --- короткие подписи на кадре либо светлые, либо на своей подложке --- */
const dimOnHero = report.heroTexts.filter((t) => !t.ownBg && t.lum < 0.35 && t.len > 2);
check(
	dimOnHero.length === 0,
	dimOnHero.length
		? `тусклая подпись прямо на кадре: «${dimOnHero[0].text}» (яркость ${dimOnHero[0].lum})`
		: 'подписи на кадре либо светлые, либо на собственной подложке'
);

/* --- описание на подложке проходит AA --- */
if (report.aboutInfo) {
	check(
		report.aboutInfo.ratio >= 4.5,
		`контраст описания ${report.aboutInfo.ratio}:1 при ${report.aboutInfo.size} (порог AA 4.5:1)`
	);
} else {
	problems.push('не нашёл блок описания под кадром');
}

await browser.close();
console.log(problems.length ? `\nПРОБЛЕМЫ:\n${problems.join('\n')}` : '\nКонтраст в порядке');
process.exit(problems.length ? 1 : 0);
