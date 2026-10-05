import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5190';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [];
const errors = [];
const trace = [];
async function viewer(name, viewport = { width: 1280, height: 800 }) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	pages.push(page);
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
	page.on('websocket', (socket) => {
		if (!socket.url().endsWith('/party')) return;
		socket.on('framereceived', ({ payload }) => {
			try {
				const m = JSON.parse(String(payload));
				if (m.type === 'state') trace.push({ viewer: name, ...m });
			} catch { /* ignore transport ping */ }
		});
	});
	await page.addInitScript(() => {
		const NativeSocket = window.WebSocket;
		window.__partySockets = [];
		window.WebSocket = class extends NativeSocket {
			constructor(...args) { super(...args); if (String(args[0]).endsWith('/party')) window.__partySockets.push(this); }
		};
	});
	if (base.includes('127.0.0.1')) {
		// Production media permits only the production origin. Test-only response
		// interception allows the local app without broadening the real VPS CORS.
		await page.route('https://video.93-123-84-128.sslip.io/**', async (route) => {
			try {
				const response = await route.fetch({ timeout: 90_000 });
				await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
			} catch { await route.abort().catch(() => {}); }
		});
	}
	return page;
}
const read = (page) => page.locator('video').evaluate((v) => ({ time: v.currentTime, paused: v.paused, rate: v.playbackRate, ready: v.readyState, width: v.videoWidth, error: v.error?.message }));
const ready = (page) => page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 120_000 });
const playing = (page) => page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.readyState >= 2; }, null, { timeout: 90_000 });
async function control(page, label) {
	await page.mouse.move(350, 730);
	await page.getByRole('button', { name: label, exact: true }).click();
}
async function aligned(host, guest, phase) {
	await Promise.all([ready(host), ready(guest)]);
	// Wait through a cold segment rather than asserting at the instant seek starts.
	for (let attempt = 0; attempt < 20; attempt++) {
		const [a, b] = await Promise.all([read(host), read(guest)]);
		if (a.ready >= 2 && b.ready >= 2 && Math.abs(a.time - b.time) < 1.6) break;
		await guest.waitForTimeout(500);
	}
	const [a, b] = await Promise.all([read(host), read(guest)]);
	console.log(JSON.stringify({ phase, host: a, guest: b, drift: Math.abs(a.time - b.time) }));
	assert.ok(Math.abs(a.time - b.time) < 1.6, `${phase}: playback drift`);
	assert.ok(!a.error && !b.error);
}
try {
	const host = await viewer('host');
	await host.goto(`${base}/movie/550-fight-club/watch`, { waitUntil: 'domcontentloaded' });
	await ready(host);
	await playing(host);
	console.log(JSON.stringify({ phase: 'host-ready' }));
	await control(host, 'Смотреть вместе');
	await host.getByLabel('Ваше имя').fill('Ведущий теста');
	await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
	await host.waitForURL(/room=/);
	await control(host, 'Смотреть вместе');
	const invite = await host.getByLabel('Ссылка-приглашение').inputValue();
	assert.ok(/\/party\/[A-Z2-9]{6}$/.test(invite));
	const guest = await viewer('guest', { width: 390, height: 844 });
	await guest.goto(invite, { waitUntil: 'domcontentloaded' });
	await guest.getByRole('button', { name: 'Присоединиться к просмотру' }).waitFor();
	await guest.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled);
	assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile invite fits viewport');
	await guest.getByLabel('Как вас зовут?').fill('Зритель теста');
	await guest.getByRole('button', { name: 'Присоединиться к просмотру' }).click();
	await guest.waitForURL(/\/watch\?room=/);
	await ready(guest);
	await playing(guest);
	await guest.waitForTimeout(3000);
	await aligned(host, guest, 'invite-and-join');
	await control(host, 'Пауза');
	await guest.waitForFunction(() => document.querySelector('video')?.paused);
	await host.evaluate(() => document.activeElement?.blur());
	const prior = (await read(host)).time;
	await host.keyboard.press('ArrowRight');
	await guest.waitForFunction((prior) => document.querySelector('video')?.currentTime > prior + 8, prior);
	await aligned(host, guest, 'pause-and-seek');
	await control(guest, 'Воспроизвести');
	await playing(host);
	await playing(guest);
	await host.getByRole('button', { name: 'Старт вместе', exact: true }).click();
	await host.waitForTimeout(14_000);
	await playing(host);
	await playing(guest);
	await aligned(host, guest, 'countdown-stays-playing');
	await host.evaluate(() => { window.__partySockets.at(-1).close(); });
	await host.waitForTimeout(5500);
	await playing(host);
	await playing(guest);
	assert.ok(await host.getByRole('button', { name: 'Старт вместе', exact: true }).count(), 'host role preserved after reconnect');
	await aligned(host, guest, 'host-reconnect');
	await guest.reload({ waitUntil: 'domcontentloaded' });
	await ready(guest);
	await playing(guest);
	await guest.waitForTimeout(3000);
	await aligned(host, guest, 'guest-refresh');
	await control(host, 'Настройки');
	const translations = host.locator('button.pitem:not(.pitem-on)').filter({ hasText: /^Торрент ·/ });
	if (await translations.count()) {
		const oldSource = await guest.locator('video').evaluate((v) => v.currentSrc);
		await translations.first().click();
		await guest.waitForFunction((src) => document.querySelector('video')?.currentSrc !== src, oldSource, { timeout: 90_000 });
		await playing(host);
		await playing(guest);
		await aligned(host, guest, 'shared-translation');
	}
	await host.getByRole('button', { name: 'Покинуть комнату', exact: true }).click();
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ passed: true, invite, statesReceived: trace.length }));
} catch (e) {
	console.log(JSON.stringify({ passed: false, error: e.message, errors, recentStates: trace.slice(-8) }));
	for (const page of pages) console.log(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(-2000) }));
	throw e;
} finally {
	await Promise.all(pages.map((page) => page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})));
	await browser.close();
}
