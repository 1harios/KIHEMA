import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5190';
const guestBase = process.argv[3] ?? base;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const pages = [];
const errors = [];
const trace = [];
const mediaRequests = [];
async function viewer(name, viewport = { width: 1280, height: 800 }) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	pages.push(page);
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
	page.on('response', (response) => {
		if (response.url().includes('/gst/')) mediaRequests.push({ viewer: name, url: response.url(), status: response.status(), cors: response.headers()['access-control-allow-origin'] });
	});
	page.on('requestfailed', (request) => {
		if (request.url().includes('/gst/')) mediaRequests.push({ viewer: name, url: request.url(), error: request.failure()?.errorText });
	});
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
	if (viewport.width < 500) await page.addInitScript(() => {
		// Exercise the iPhone-style fallback rather than the desktop-only API.
		HTMLElement.prototype.requestFullscreen = async () => { throw new Error('No element fullscreen'); };
		const nativeHeight = visualViewport.height;
		window.__testViewportHeight = nativeHeight;
		Object.defineProperty(visualViewport, 'height', { get: () => window.__testViewportHeight });
	});
	await page.route('**/api/playback/resolve', async (route) => {
		const data = route.request().postDataJSON();
		// A second catalog title using the same known-good media fixture. This
		// tests navigation and coordination, not the availability of a torrent.
		if (data.tmdbId === 13) {
			const response = await route.fetch({ postData: JSON.stringify({ ...data, tmdbId: 550 }) });
			await route.fulfill({ response });
		} else await route.continue();
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
	await page.locator('.player-video').hover();
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
async function changedRoomStarted(changeId) {
	for (let attempt = 0; attempt < 360; attempt++) {
		const state = trace.findLast((s) => s.viewer === 'guest');
		if (state && state.changeId > changeId && !state.paused && !state.waitingForReady && !state.sourcePending && state.serverTs >= state.anchorTs) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.fail('The changed source did not complete the common readiness/countdown barrier');
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
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	const invite = await host.getByLabel('Ссылка-приглашение').inputValue();
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	assert.ok(/\/party\/[A-Z2-9]{6}$/.test(invite));
	assert.equal(new URL(invite).origin, new URL(base).origin);
	const guestInvite = new URL(new URL(invite).pathname, guestBase).href;
	const guest = await viewer('guest', { width: 390, height: 844 });
	await guest.goto(guestInvite, { waitUntil: 'domcontentloaded' });
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
	await control(guest, 'Полный экран');
	assert.ok(await guest.locator('.player-shell.page-fullscreen').count(), 'mobile fallback enters fullscreen');
	await control(guest, 'Смотреть вместе');
	assert.equal(await guest.getByLabel('Ссылка-приглашение').count(), 0, 'invitation does not consume chat height');
	assert.ok(await guest.evaluate(() => document.querySelector('.player-shell').contains(document.querySelector('[aria-label="Чат совместного просмотра"]'))));
	const layout = () => guest.evaluate(() => {
		const panel = document.querySelector('[aria-label="Чат совместного просмотра"]').getBoundingClientRect();
		const feed = document.querySelector('[aria-label="Сообщения комнаты"]').getBoundingClientRect();
		const input = document.querySelector('[aria-label="Сообщение в чат"]').getBoundingClientRect();
		return { panelHeight: panel.height, chatHeight: feed.height, inputBottom: input.bottom, viewportHeight: visualViewport.height };
	});
	assert.ok((await layout()).chatHeight > 300, 'mobile chat has enough space');
	await guest.getByLabel('Сообщение в чат').fill('Сообщение с телефона');
	await guest.getByRole('button', { name: 'Отправить', exact: true }).click();
	await host.getByRole('log').getByText('Сообщение с телефона').waitFor();
	await guest.screenshot({ path: join(tmpdir(), 'kihema-party-portrait.png') });
	await guest.evaluate(() => { window.__testViewportHeight = 400; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.waitForTimeout(300);
	const keyboardLayout = await layout();
	assert.ok(keyboardLayout.inputBottom <= 401 && keyboardLayout.chatHeight > 100, 'keyboard leaves the composer and chat visible');
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.setViewportSize({ width: 320, height: 568 });
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.locator('.player-video').hover();
	assert.ok(await guest.getByRole('button', { name: 'Выйти из полного экрана', exact: true }).evaluate((button) => button.getBoundingClientRect().right <= innerWidth), 'fullscreen control fits a 320px phone');
	await guest.setViewportSize({ width: 844, height: 390 });
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.waitForTimeout(300);
	await guest.screenshot({ path: join(tmpdir(), 'kihema-party-landscape.png') });
	assert.ok(await guest.evaluate(() => document.querySelector('video').getBoundingClientRect().right <= document.querySelector('[aria-label="Чат совместного просмотра"]').getBoundingClientRect().left + 1), 'landscape chat sits beside video');
	await guest.evaluate(() => { window.__testViewportHeight = 180; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.waitForTimeout(200);
	assert.ok((await layout()).inputBottom <= 181, 'landscape keyboard does not hide the composer');
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
	await control(guest, 'Выйти из полного экрана');
	await guest.setViewportSize({ width: 390, height: 844 });
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await control(host, 'Полный экран');
	assert.ok(await host.evaluate(() => document.fullscreenElement?.contains(document.querySelector('[aria-label="Чат совместного просмотра"]'))), 'native fullscreen includes chat');
	await control(host, 'Выйти из полного экрана');
	await guest.locator('video').evaluate((video) => {
		const track = video.addTextTrack('subtitles', 'Тестовые субтитры', 'ru');
		track.addCue(new VTTCue(0, video.duration, 'Проверка субтитров'));
	});
	await control(guest, 'Настройки');
	await guest.getByRole('button', { name: 'Тестовые субтитры', exact: true }).click();
	assert.ok(await guest.locator('video').evaluate((video) => Array.from(video.textTracks).some((t) => t.mode === 'showing')));
	await guest.getByRole('button', { name: 'Выключены', exact: true }).click();
	assert.ok(await guest.locator('video').evaluate((video) => Array.from(video.textTracks).every((t) => t.mode !== 'showing')));
	await control(guest, 'Настройки');
	console.log(JSON.stringify({ phase: 'mobile-fullscreen-chat-subtitles', keyboardLayout, screenshots: [join(tmpdir(), 'kihema-party-portrait.png'), join(tmpdir(), 'kihema-party-landscape.png')] }));
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
		const previousChange = trace.findLast((s) => s.viewer === 'guest')?.changeId ?? 0;
		const sourceChanged = guest.waitForEvent('request', { predicate: (r) => r.url().includes('/api/playback/resolve') || r.url().includes('master.m3u8'), timeout: 90_000 });
		await translations.first().click();
		await guest.getByText(/^Ведущий меняет озвучку:/).waitFor();
		await sourceChanged;
		await changedRoomStarted(previousChange);
		await playing(host);
		await playing(guest);
		await aligned(host, guest, 'shared-translation');
	}
	if (await host.locator('.player-settings').count()) await control(host, 'Настройки');
	if (!(await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).count())) await control(host, 'Смотреть вместе');
	await host.route('**/api/search?**', (route) => route.fulfill({ json: { titles: [{ type: 'movie', tmdbId: 13, title: 'Форрест Гамп', originalTitle: 'Forrest Gump', year: 1994 }] } }));
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	await host.getByRole('button', { name: 'Сменить фильм', exact: true }).click();
	await host.getByLabel('Поиск фильма для комнаты').fill('Форрест');
	const previousMovieChange = trace.findLast((s) => s.viewer === 'guest')?.changeId ?? 0;
	await host.getByRole('button', { name: 'Форрест Гамп 1994' }).click();
	await guest.getByText('Ведущий сменил фильм: Форрест Гамп', { exact: true }).waitFor();
	await Promise.all([host.waitForURL(/13-forrest-gump\/watch/), guest.waitForURL(/13-forrest-gump\/watch/)]);
	await changedRoomStarted(previousMovieChange);
	await playing(host); await playing(guest);
	await aligned(host, guest, 'shared-movie');
	await control(host, 'Смотреть вместе');
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	await host.getByRole('button', { name: 'Покинуть комнату', exact: true }).click();
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ passed: true, invite, guestInvite, statesReceived: trace.length }));
} catch (e) {
	console.log(JSON.stringify({ passed: false, error: e.message, errors, recentStates: trace.slice(-8), recentMedia: mediaRequests.slice(-12) }));
	for (const page of pages) console.log(JSON.stringify({ url: page.url(), body: (await page.locator('body').innerText()).slice(-2000), video: await read(page).catch(() => null) }));
	throw e;
} finally {
	await Promise.all(pages.map((page) => page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})));
	await browser.close();
}
