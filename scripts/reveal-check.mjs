/**
 * Проверка появления секций.
 *
 * use:reveal прячет блок до пересечения с кадром. Если наблюдатель по любой
 * причине не сработает, страница останется наполовину пустой — а сборка и
 * svelte-check об этом ничего не скажут. Поэтому здесь страница прокручивается
 * до конца и проверяется, что у всех секций opacity вернулась к единице.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const PATHS = ['/', '/movie/27205-nachalo'];

const browser = await chromium.launch();
const problems = [];

for (const path of PATHS) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 });
	await page.waitForTimeout(900);

	// Прокрутка шагами: наблюдатель срабатывает на входе в кадр, а не на конце.
	for (let i = 0; i < 24; i++) {
		await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
		await page.waitForTimeout(180);
	}
	await page.waitForTimeout(900);

	const hidden = await page.evaluate(() =>
		[...document.querySelectorAll('.reveal')]
			.filter((el) => Number(getComputedStyle(el).opacity) < 0.9)
			.map((el) => (el.querySelector('h2')?.textContent ?? el.className).trim().slice(0, 60))
	);
	if (hidden.length) problems.push(`${path}: остались скрытыми -> ${hidden.join(' | ')}`);

	const total = await page.evaluate(
		() => document.querySelectorAll('.reveal, .reveal-in').length
	);
	console.log(`${path}: блоков с появлением — ${total}, скрытых — ${hidden.length}`);
	await page.close();
}

await browser.close();
if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
console.log('Все блоки показались');
