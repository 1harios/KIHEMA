/**
 * Проверка всплывающей панели с описанием.
 *
 * Проверяется поведением, потому что ни типы, ни сборка про панель ничего не
 * знают: она появляется по таймеру после наведения, дозагружает подробности
 * запросом и позиционируется от координат карточки. Отдельно проверяется, что
 * панель не срезается краем ряда — именно из-за обрезки её пришлось выносить в
 * отдельный слой.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));

const check = (ok, what) => {
	if (!ok) problems.push(what);
	console.log(`${ok ? 'ок  ' : 'СБОЙ'} ${what}`);
};

await page.goto(`${BASE}/catalog/movies`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const pop = page.locator('.preview-grow');

/* --- панель ждёт 1,5 секунды --- */
const card = page.locator('.poster-grid > *').nth(2);
const poster = card.locator('.lift').first();
const posterBox = await poster.boundingBox();
await card.hover();
await page.waitForTimeout(900);
check(!(await pop.isVisible().catch(() => false)), 'через 0,9 секунды панели ещё нет');

await page.waitForTimeout(900);
check(await pop.isVisible().catch(() => false), 'после 1,5 секунд панель появилась');

/* --- панель разворачивается ИЗ обложки: накрывает её и центрирована на ней --- */
const popBox = await pop.boundingBox();
const covers =
	popBox &&
	posterBox &&
	popBox.x <= posterBox.x + 2 &&
	popBox.x + popBox.width >= posterBox.x + posterBox.width - 2;
check(Boolean(covers), 'панель шире обложки и накрывает её');

const centered =
	popBox &&
	posterBox &&
	Math.abs(popBox.x + popBox.width / 2 - (posterBox.x + posterBox.width / 2)) < 6;
check(Boolean(centered), 'панель центрирована на обложке');

/* --- точка роста указывает в центр обложки --- */
const origin = await pop.evaluate((el) => getComputedStyle(el).transformOrigin);
check(/^\d/.test(origin), `точка роста задана явно (${origin})`);

/* --- положение не зависит от измеренной высоты: панель не прыгает --- */
const before = await pop.boundingBox();
await page.waitForTimeout(500);
const after = await pop.boundingBox();
check(
	Boolean(before && after && Math.abs(before.y - after.y) < 2 && Math.abs(before.x - after.x) < 2),
	'панель не сдвигается после появления'
);

/* --- содержимое --- */
const text = (await pop.innerText().catch(() => '')) || '';
check(/Фильм/.test(text), 'в панели есть тип тайтла');
check(text.length > 60, `в панели есть описание и факты (символов: ${text.length})`);
check(
	(await pop.locator('a', { hasText: /Смотреть|Продолжить|Подробнее/ }).count()) > 0,
	'в панели есть основное действие'
);

/* --- панель целиком в пределах экрана --- */
const box = await pop.boundingBox();
const vp = page.viewportSize();
check(
	box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height,
	`панель целиком на экране (x:${Math.round(box?.x ?? -1)} y:${Math.round(box?.y ?? -1)} w:${Math.round(box?.width ?? 0)} h:${Math.round(box?.height ?? 0)})`
);

/* --- ничего не обрезает: панель выше ряда по слоям --- */
const clipped = await pop.evaluate((el) => {
	const r = el.getBoundingClientRect();
	// Точка в середине панели должна принадлежать самой панели, а не чему-то над ней.
	const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 8);
	return !el.contains(hit);
});
check(!clipped, 'панель ничем не перекрыта и не срезана');

await page.screenshot({ path: '/tmp/shots/hover-panel.png' });

/* --- переход на другую карточку: старая панель не остаётся --- */
const other = page.locator('.poster-grid > *').nth(4);
await other.hover();
await page.waitForTimeout(400);
check(
	!(await pop.isVisible().catch(() => false)),
	'при переходе на другую карточку прошлая панель закрывается сразу'
);
await page.waitForTimeout(1400);
check(await pop.isVisible().catch(() => false), 'на новой карточке панель открывается');

/* --- уводим курсор: панель закрывается --- */
await page.mouse.move(5, 5);
await page.waitForTimeout(700);
check(!(await pop.isVisible().catch(() => false)), 'панель закрывается, когда курсор ушёл');

/* --- щелчок по карточке не открывает панель на странице фильма --- */
await page.locator('.poster-grid > *').nth(1).locator('a').last().click();
await page.waitForTimeout(2600);
check(
	!(await pop.isVisible().catch(() => false)),
	`после перехода на страницу фильма панели нет (${page.url().replace(BASE, '')})`
);
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);

/* --- у крайней правой карточки панель не уезжает за край --- */
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const lastVisible = page.locator('.snap-row').first().locator('> *').nth(6);
await lastVisible.hover().catch(() => {});
await page.waitForTimeout(2200);
if (await pop.isVisible().catch(() => false)) {
	const b = await pop.boundingBox();
	check(b && b.x + b.width <= vp.width, 'у крайней карточки ряда панель зажата в экран');
} else {
	console.log('прим  крайняя карточка ряда вне экрана — проверка пропущена');
}

/* --- надёжность: панель обязана появиться на каждой из шести карточек --- */
await page.goto(`${BASE}/catalog/movies`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1100);
{
	let misses = [];
	for (let i = 0; i < 6; i++) {
		const c = page.locator('.poster-grid > *').nth(i);
		const box = await c.boundingBox();
		if (!box) continue;
		// Двигаем курсор внутри карточки: именно движение — второй источник
		// сигнала, который лечит пропущенный вход из-за перекрытия панелью.
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2 + 4);
		await page.waitForTimeout(1800);
		// Сверяем не «панель видна», а «панель про эту карточку»: панель предыдущей
		// накрывает следующую, и без сверки названия проверка проходила бы вхолостую.
		const name = (await c.locator('a .sr-only').first().innerText().catch(() => '')) || '';
		const shown = (await pop.innerText().catch(() => '')) || '';
		if (!name || !shown.includes(name.trim())) misses.push(`${i + 1}${name ? ` (${name.trim()})` : ''}`);
	}
	check(misses.length === 0, `панель появилась на всех шести карточках подряд${
		misses.length ? ` (пропуски: ${misses.join(', ')})` : ''
	}`);
}

/* --- ряд актёров: стрелки появились и ряд реально сдвигается --- */
await page.goto(`${BASE}/movie/27205-nachalo`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const castRow = page
	.locator('section', { has: page.getByRole('heading', { name: 'В ролях' }) })
	.first();
await castRow.scrollIntoViewIfNeeded();
await castRow.hover();
await page.waitForTimeout(400);

const scroller = castRow.locator('.snap-row');
const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 8);
const next = castRow.getByRole('button', { name: 'Прокрутить вперёд' });

if (overflows) {
	// Ряд длиннее экрана — стрелка обязана быть, иначе мышью его не сдвинуть.
	check((await next.count()) > 0, 'у длинного ряда актёров есть стрелка прокрутки');
	if (await next.count()) {
		const beforeX = await scroller.evaluate((el) => el.scrollLeft);
		await next.click();
		await page.waitForTimeout(800);
		const afterX = await scroller.evaluate((el) => el.scrollLeft);
		check(afterX > beforeX + 50, `ряд актёров сдвигается стрелкой (${beforeX} -> ${afterX})`);
	}
} else {
	// Ряд влезает целиком — стрелки быть не должно, иначе она ведёт в пустоту.
	check((await next.count()) === 0, 'короткий ряд актёров обходится без стрелки');
}

/* --- панель наведения одинакова на главной и в каталоге --- */
for (const [where, path, sel] of [
	['главная', '/', '.snap-row > *'],
	['каталог', '/catalog/movies', '.poster-grid > *']
]) {
	await page.goto(BASE + path, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1100);
	await page.locator(sel).nth(1).hover();
	await page.waitForTimeout(1900);
	check(await pop.isVisible().catch(() => false), `панель работает: ${where}`);
	await page.mouse.move(2, 2);
	await page.waitForTimeout(400);
}

await browser.close();
console.log(problems.length ? `\nПРОБЛЕМЫ:\n${problems.join('\n')}` : '\nВсё сходится');
process.exit(problems.length ? 1 : 0);
