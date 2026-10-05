/** Real RUTUBE video in two isolated browsers and the live room server. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.argv[2] || 'https://kihema.vercel.app';
const guestBase = process.argv[3] || 'https://kihema.93-123-84-128.sslip.io';
const id = '564f31c881b83373bfe0cb26979d44cf';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const states = [];
const events = [];
async function viewer(name, viewport) {
	const page = await (await browser.newContext({ viewport })).newPage();
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
	page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
		try { const m = JSON.parse(String(payload)); if (m.type === 'state') states.push({ viewer: name, ...m }); } catch {}
	}));
	await page.exposeFunction('__rutubeEvent', (m) => events.push({ viewer: name, ...m }));
	await page.addInitScript(() => addEventListener('message', (event) => {
		if (event.origin !== 'https://rutube.ru') return;
		try {
			const m = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
			if (m?.type?.startsWith('player:')) window.__rutubeEvent({ type: m.type, state: m.data?.state, time: m.data?.time, duration: m.data?.duration, list: m.type === 'player:qualityList' ? m.data?.list : undefined });
		} catch {}
	}));
	return page;
}
const iframe = (page) => page.frames().find((frame) => frame.url().startsWith('https://rutube.ru/play/embed/'));
async function ready(page) {
	for (let attempt = 0; attempt < 300 && !iframe(page); attempt++) await page.waitForTimeout(100);
	assert.ok(iframe(page), 'The official RUTUBE frame navigated');
	await iframe(page).waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.duration > 100 && v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 90_000 });
}
async function read(page) {
	return iframe(page).evaluate(() => {
		const v = [...document.querySelectorAll('video')].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
		return v ? { time: v.currentTime, paused: v.paused, duration: v.duration, ready: v.readyState, width: v.videoWidth } : null;
	});
}
async function control(page, label) {
	const wake = page.getByRole('button', { name: 'Показать управление', exact: true });
	if (await wake.count()) await wake.click();
	await page.getByRole('button', { name: label, exact: true }).click();
}
async function playing(page) {
	await iframe(page).waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.duration > 100 && v.videoWidth > 0 && !v.paused && v.currentTime > .5), null, { timeout: 45_000 });
}
try {
	const host = await viewer('host', { width: 1280, height: 800 });
	await host.goto(`${base}/rutube/${id}/watch`, { waitUntil: 'domcontentloaded' });
	await host.locator('iframe').waitFor();
	await host.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
	await ready(host);
	console.log(JSON.stringify({ phase: 'real-rutube-loaded', host: await read(host), qualityList: events.findLast((e) => e.type === 'player:qualityList')?.list }));
	await control(host, 'Смотреть вместе');
	await host.getByLabel('Ваше имя').fill('RUTUBE ведущий');
	await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
	await host.waitForURL(/room=/);
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	const invite = await host.getByLabel('Ссылка-приглашение').inputValue();
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	const guest = await viewer('guest', { width: 390, height: 844 });
	await guest.goto(new URL(new URL(invite).pathname, guestBase).href, { waitUntil: 'domcontentloaded' });
	await guest.getByLabel('Как вас зовут?').fill('RUTUBE зритель');
	await guest.getByRole('button', { name: 'Присоединиться к просмотру' }).click();
	await guest.waitForURL(/\/watch\?room=/);
	await guest.locator('iframe').waitFor();
	await guest.getByRole('button', { name: 'Загрузить видео', exact: true }).click({ timeout: 30_000 }).catch((error) => {
		console.log(JSON.stringify({ phase: 'guest-initialize', message: error.message.split('\n')[0] }));
	});
	await ready(guest);
	await Promise.all([playing(host), playing(guest)]);
	await host.waitForTimeout(3000);
	let [a, b] = await Promise.all([read(host), read(guest)]);
	assert.ok(Math.abs(a.time - b.time) < 1.6, 'Real video playback aligned');
	console.log(JSON.stringify({ phase: 'real-rutube-two-viewers', host: a, guest: b, drift: Math.abs(a.time - b.time) }));
	await control(host, 'Пауза');
	await iframe(guest).waitForFunction(() => [...document.querySelectorAll('video')].filter((v) => v.duration > 100).every((v) => v.paused));
	await host.getByLabel('Перемотка общего видео').evaluate((input) => { input.value = '45'; input.dispatchEvent(new Event('change', { bubbles: true })); });
	await iframe(guest).waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.duration > 100 && Math.abs(v.currentTime - 45) < 1.5), null, { timeout: 25_000 });
	await control(host, 'Воспроизвести');
	await Promise.all([playing(host), playing(guest)]);
	await host.waitForTimeout(4000);
	[a, b] = await Promise.all([read(host), read(guest)]);
	assert.ok(Math.abs(a.time - b.time) < 1.6, 'Shared seek resumes aligned');
	await control(guest, 'Открыть чат');
	await guest.getByRole('button', { name: 'Реакция 👍', exact: true }).click();
	await host.getByLabel('Реакции участников').getByText('👍', { exact: true }).waitFor();
	await guest.getByLabel('Сообщение в чат').fill('Настоящее видео RUTUBE вдвоём');
	await guest.getByRole('button', { name: 'Отправить', exact: true }).click();
	await host.getByRole('log').getByText('Настоящее видео RUTUBE вдвоём').waitFor();
	assert.equal(errors.length, 0, errors.join('\n'));
	console.log(JSON.stringify({ ok: true, realProvider: true, phase: 'pause-seek-reactions-chat', host: a, guest: b, drift: Math.abs(a.time - b.time) }));
} catch (error) {
	console.error(JSON.stringify({ errors, states: states.slice(-8), events: events.slice(-15) }));
	throw error;
} finally { await browser.close(); }
