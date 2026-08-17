/**
 * Снимок карточки в покое и при наведении.
 *
 * Карточку переделали: бейдж воспроизведения из правого верхнего угла убран,
 * вместо него центральная кнопка при наведении, а под постером — полоса
 * просмотра. Проверять это глазами обязательно: hover-состояние не видно ни в
 * обычных снимках, ни в сборке.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const OUT = '/tmp/shots';

// Прогресс для демо-тайтла, чтобы на карточке появилась полоса.
const PROGRESS = [
	{
		tmdbId: 27205,
		type: 'movie',
		title: 'Начало',
		positionSec: 4200,
		durationSec: 8880,
		updatedAt: Date.now()
	}
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(
	([k, v]) => localStorage.setItem(k, v),
	['kinema:progress:v1', JSON.stringify(PROGRESS)]
);
const page = await ctx.newPage();

await page.goto(`${BASE}/catalog/movies`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const grid = page.locator('.poster-grid, [class*="poster-grid"]').first();
await grid.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/card-rest.png`, clip: await clipOf(grid) });

// Наводимся на вторую карточку — у первой сверху может лежать липкая панель.
const card = page.locator('.poster-grid > *').nth(1);
await card.hover();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/card-hover.png`, clip: await clipOf(grid) });

async function clipOf(loc) {
	const box = await loc.boundingBox();
	if (!box) return undefined;
	return {
		x: box.x,
		y: box.y,
		width: Math.min(box.width, 1280),
		height: Math.min(box.height, 520)
	};
}

await browser.close();
console.log('card-rest.png / card-hover.png готовы');
