/**
 * Проверка, что выбор сети на главной не выбрасывает наверх.
 *
 * Это была жалоба пользователя: чипсы сетей — обычные ссылки, и SvelteKit по
 * умолчанию сбрасывает прокрутку при навигации. Проверяем по факту: скроллим до
 * чипсов, нажимаем и сравниваем позицию до и после.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const chip = page.getByRole('link', { name: 'Netflix', exact: true }).first();
await chip.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

const before = await page.evaluate(() => window.scrollY);
await chip.click();
await page.waitForTimeout(1200);
const after = await page.evaluate(() => window.scrollY);

console.log(`прокрутка до: ${Math.round(before)}, после: ${Math.round(after)}`);
if (before > 200 && after < before - 100) {
	console.error('ОШИБКА: выбор сети всё ещё выбрасывает страницу наверх');
	process.exit(1);
}
console.log('позиция сохранена');
await browser.close();
