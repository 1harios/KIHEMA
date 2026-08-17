/**
 * Снимки экранов для визуальной проверки.
 *
 * Нужны потому, что svelte-check и vite build проходят чисто даже когда
 * гидрация падает в рантайме: однажды бесконечный цикл в эффекте убил всю
 * интерактивность сайта, а обе проверки молчали. Поэтому здесь же собираются
 * ошибки консоли — они и есть главный результат, снимки вторичны.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const OUT = process.env.OUT ?? '/tmp/shots';
mkdirSync(OUT, { recursive: true });

/** Прогресс просмотра — клиентское хранилище, поэтому засеваем его вручную. */
const PROGRESS = [
	{
		tmdbId: 693134,
		type: 'movie',
		title: 'Дюна: Часть вторая',
		poster: 'https://image.tmdb.org/t/p/w342/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
		backdrop: 'https://image.tmdb.org/t/p/w780/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg',
		positionSec: 3120,
		durationSec: 9960,
		updatedAt: Date.now()
	},
	{
		tmdbId: 1399,
		type: 'show',
		title: 'Игра престолов',
		poster: 'https://image.tmdb.org/t/p/w342/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
		backdrop: 'https://image.tmdb.org/t/p/w780/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg',
		season: 1,
		episode: 4,
		episodeTitle: 'Калеки, бастарды и сломанные вещи',
		positionSec: 1450,
		durationSec: 3300,
		updatedAt: Date.now() - 60_000
	}
];

const PAGES = [
	{ name: 'home', path: '/' },
	{ name: 'catalog', path: '/catalog/movies?filters=1' },
	{ name: 'title', path: '/movie/27205-nachalo' }
];

const VIEWPORTS = [
	{ name: '390', width: 390, height: 844 },
	{ name: '768', width: 768, height: 1024 },
	{ name: '1440', width: 1440, height: 900 }
];

const browser = await chromium.launch();
const problems = [];

for (const vp of VIEWPORTS) {
	const ctx = await browser.newContext({
		viewport: { width: vp.width, height: vp.height },
		deviceScaleFactor: 1
	});

	// Засев до загрузки страницы: иначе первый рендер увидит пустое хранилище.
	await ctx.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				/* приватный режим — не критично для снимка */
			}
		},
		['kinema:progress:v1', JSON.stringify(PROGRESS)]
	);

	const page = await ctx.newPage();
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(`[${vp.name}] console: ${m.text().slice(0, 300)}`);
	});
	page.on('pageerror', (e) => problems.push(`[${vp.name}] pageerror: ${String(e).slice(0, 300)}`));

	for (const p of PAGES) {
		await page.goto(BASE + p.path, { waitUntil: 'networkidle', timeout: 45_000 }).catch((e) => {
			problems.push(`[${vp.name}] ${p.path}: ${e.message.slice(0, 160)}`);
		});
		// Ждём гидрацию: без неё ряд «продолжить» и фильтры физически не появятся.
		await page.waitForTimeout(1400);
		await page.screenshot({ path: `${OUT}/${p.name}-${vp.name}.png` });

		// Панель фильтров открывается кнопкой, а не адресом: без нажатия на снимке
		// её просто нет, и проверять было бы нечего.
		if (p.name === 'catalog') {
			await page
				.getByRole('button', { name: /Фильтры/ })
				.first()
				.click()
				.catch((e) => problems.push(`[${vp.name}] фильтры не открылись: ${e.message.slice(0, 120)}`));
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${OUT}/filters-${vp.name}.png` });
		}

		// Ряд продолжения — единственный блок, которого нет в серверной разметке:
		// если он не появился, значит гидрация упала, а не «просто пусто».
		if (p.name === 'home') {
			const hasRow = await page
				.getByText('Продолжить просмотр', { exact: true })
				.count()
				.catch(() => 0);
			if (!hasRow) problems.push(`[${vp.name}] нет ряда «Продолжить просмотр» — проверить гидрацию`);

			// Второй экран: подбор и первые ряды с уже сработавшим reveal.
			await page.evaluate(() => window.scrollTo(0, window.innerHeight - 40));
			await page.waitForTimeout(1100);
			await page.screenshot({ path: `${OUT}/home2-${vp.name}.png` });
		}
	}

	await ctx.close();
}

await browser.close();
console.log(problems.length ? problems.join('\n') : 'Ошибок в консоли нет');
