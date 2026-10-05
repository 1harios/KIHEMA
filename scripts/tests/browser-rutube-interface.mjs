/** Real embed: verify one control bar and readable quality on desktop/touch. */
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:5190';
const id = '564f31c881b83373bfe0cb26979d44cf';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
	for (const mobile of [false, true]) {
		const context = await browser.newContext(mobile ? { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1280, height: 800 } });
		const page = await context.newPage();
		page.on('pageerror', (e) => errors.push(e.message));
		await page.addInitScript(() => {
			window.__qualities = [];
			addEventListener('message', (event) => {
				if (event.origin !== 'https://rutube.ru') return;
				try {
					const m = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
					if (m.type === 'player:currentQuality') window.__qualities.push(m.data.quality);
				} catch {}
			});
		});
		await page.goto(`${base}/rutube/${id}/watch`, { waitUntil: 'domcontentloaded' });
		await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click({ timeout: 30_000 });
		const frame = page.frames().find((f) => f.url().startsWith('https://rutube.ru/play/embed/'));
		assert.ok(frame, 'Official embed loaded');
		assert.equal(new URL(frame.url()).searchParams.get('hideControls'), 'true');
		await frame.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.currentTime > .5 && !v.paused), null, { timeout: 60_000 });
		const wake = async () => { const button = page.getByRole('button', { name: 'Показать управление', exact: true }); if (await button.count()) await button.click(); };
		await wake();
		await page.getByRole('button', { name: 'Качество RUTUBE', exact: true }).click();
		const panel = page.getByRole('region', { name: 'Настройки плеера RUTUBE' });
		await panel.getByRole('button', { name: /^720p/ }).waitFor({ timeout: 20_000 });
		assert.ok(await panel.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
		await page.screenshot({ path: join(tmpdir(), `kihema-rutube-quality-${mobile ? 'mobile' : 'desktop'}.png`) });
		await panel.getByRole('button', { name: /^720p/ }).click();
		await page.waitForFunction(() => window.__qualities.some((q) => q.isAutoQuality === false && String(q.quality) === '720'), null, { timeout: 30_000 });
		await page.waitForTimeout(1000);
		const before = await frame.evaluate(() => [...document.querySelectorAll('video')].find((v) => v.duration > 100)?.currentTime);
		await page.waitForTimeout(2000);
		const after = await frame.evaluate(() => [...document.querySelectorAll('video')].find((v) => v.duration > 100)?.currentTime);
		assert.ok(after > before, 'Real video keeps playing after quality change');
		await frame.locator('body').hover();
		assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('[class*="controls-module__"]')].filter((el) => {
			if (!el.getBoundingClientRect().width || !el.getBoundingClientRect().height) return false;
			for (let node = el; node; node = node.parentElement) { const css = getComputedStyle(node); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false; }
			return true;
		}).map((el) => el.className)), [], 'Native controls do not reappear on hover');
		await wake();
		await page.getByRole('button', { name: 'Качество RUTUBE', exact: true }).click();
		await panel.getByRole('button', { name: /^Авто/ }).click();
		await page.waitForFunction(() => window.__qualities.at(-1)?.isAutoQuality === true, null, { timeout: 30_000 });
		if (mobile) {
			await page.setViewportSize({ width: 320, height: 568 });
			await wake();
			await page.getByRole('button', { name: 'Качество RUTUBE', exact: true }).click();
			assert.ok(await page.getByRole('button', { name: 'Полный экран', exact: true }).evaluate((el) => el.getBoundingClientRect().right <= innerWidth));
			assert.ok(await panel.evaluate((el) => el.getBoundingClientRect().right <= innerWidth));
		}
		console.log(JSON.stringify({ base, mobile, realProvider: true, selected720: true, resumedAuto: true, duplicatedControls: false, playbackAdvanced: after - before }));
		await context.close();
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
