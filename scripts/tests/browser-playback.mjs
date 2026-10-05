import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://kihema.vercel.app/movie/550-fight-club/watch';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => {
	if (msg.type() === 'error' && /hls|media|video|stream/i.test(msg.text())) errors.push(msg.text().slice(0, 250));
});
try {
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
	await page.waitForFunction(() => {
		const v = document.querySelector('video');
		return v && v.readyState >= 2 && v.currentTime > 3 && !v.paused;
	}, null, { timeout: 90_000 });
	const read = () => page.locator('video').evaluate((v) => ({
		time: v.currentTime, duration: v.duration, width: v.videoWidth, height: v.videoHeight,
		readyState: v.readyState, paused: v.paused, error: v.error?.message
	}));
	const before = await read();
	await page.waitForTimeout(3_000);
	const after = await read();
	console.log(JSON.stringify({ phase: 'playing', before, after, errors }));
	assert.ok(after.time > before.time + 1);
	assert.ok(after.width > 0 && after.height > 0);
	assert.ok(!after.error);
	await page.locator('video').evaluate((v) => { v.currentTime = Math.min(v.currentTime + 25, v.duration - 5); });
	await page.waitForTimeout(6_000);
	const seek = await read();
	console.log(JSON.stringify({ phase: 'seek', ...seek }));
	assert.ok(seek.time > after.time + 24);
	assert.ok(!seek.error);
	await page.mouse.move(640, 650);
	await page.getByRole('button', { name: 'Настройки', exact: true }).click();
	const translations = page.getByRole('button', { name: /^Торрент ·/ });
	const count = await translations.count();
	console.log(JSON.stringify({ phase: 'translation-menu', count }));
	if (count > 1) {
		const oldSrc = await page.locator('video').evaluate((v) => v.currentSrc);
		const next = page.locator('button.pitem:not(.pitem-on)').filter({ hasText: /^Торрент ·/ }).first();
		const label = await next.innerText();
		await next.click();
		await page.waitForFunction((src) => {
			const v = document.querySelector('video');
			return v && v.currentSrc !== src && v.readyState >= 2 && !v.paused;
		}, oldSrc, { timeout: 65_000 });
		const switched = await read();
		console.log(JSON.stringify({ phase: 'translation-switched', label, ...switched }));
		assert.ok(switched.time >= seek.time - 1);
		assert.ok(!switched.error);
	}
	console.log(JSON.stringify({ passed: true, url: page.url() }));
} catch (e) {
	console.log(JSON.stringify({ passed: false, error: e.message, errors, page: (await page.locator('body').innerText()).slice(-1800) }));
	throw e;
} finally {
	await browser.close();
}
