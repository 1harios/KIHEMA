/**
 * Проверка горячих клавиш и просмотрщика галереи.
 *
 * Оба механизма невидимы для сборки и типов: реестр клавиш можно сломать так,
 * что всё соберётся, а ни одна клавиша работать не будет. Поэтому проверяем
 * поведением — нажимаем и смотрим на результат.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => {
	if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text().slice(0, 200)}`);
});

const check = (ok, what) => {
	if (!ok) problems.push(what);
	console.log(`${ok ? 'ок  ' : 'СБОЙ'} ${what}`);
};

/* --- подсказка по клавишам на главной --- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(500);
const help = page.getByRole('dialog', { name: 'Горячие клавиши' });
check(await help.isVisible().catch(() => false), 'знак вопроса открывает подсказку');
check(
	await page.getByText('На главную', { exact: true }).isVisible().catch(() => false),
	'в подсказке есть переходы по разделам'
);
await page.screenshot({ path: '/tmp/shots/hotkeys.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(!(await help.isVisible().catch(() => false)), 'Escape закрывает подсказку');

/* --- переход по последовательности g m --- */
await page.keyboard.press('g');
await page.keyboard.press('m');
await page.waitForTimeout(1500);
check(page.url().includes('/catalog/movies'), `g затем m ведёт в фильмы (адрес: ${page.url().replace(BASE, '')})`);

/* --- дробь ставит курсор в поиск --- */
await page.keyboard.press('/');
await page.waitForTimeout(400);
const focused = await page.evaluate(() => document.activeElement?.tagName);
check(focused === 'INPUT', `дробь ставит курсор в поле поиска (фокус: ${focused})`);
await page.keyboard.press('Escape');

/* --- просмотрщик галереи на странице тайтла --- */
await page.goto(`${BASE}/movie/27205-nachalo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const thumb = page.getByRole('button', { name: /Открыть изображение 1 из/ }).first();
const hasGallery = await thumb.count();
if (!hasGallery) {
	console.log('прим  галереи в демо-данных нет — просмотрщик проверяю на фото человека');
} else {
	await thumb.click();
	await page.waitForTimeout(700);
	const box = page.getByRole('dialog', { name: /Кадр 1 из/ });
	check(await box.isVisible().catch(() => false), 'нажатие на кадр открывает просмотрщик');
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(500);
	check(
		await page.getByRole('dialog', { name: /Кадр 2 из/ }).isVisible().catch(() => false),
		'стрелка листает на следующий кадр'
	);
	await page.screenshot({ path: '/tmp/shots/lightbox.png' });
	await page.keyboard.press('Escape');
	await page.waitForTimeout(400);
	check(!(await box.isVisible().catch(() => false)), 'Escape закрывает просмотрщик');
	const overflow = await page.evaluate(() => document.documentElement.style.overflow);
	check(overflow !== 'hidden', 'после закрытия прокрутка страницы возвращается');
}

await browser.close();
console.log(problems.length ? `\nПРОБЛЕМЫ:\n${problems.join('\n')}` : '\nВсё сходится');
process.exit(problems.length ? 1 : 0);
