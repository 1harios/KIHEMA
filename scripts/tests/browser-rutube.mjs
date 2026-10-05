/**
 * Two real browsers + real room server, with a deterministic official iframe
 * API fixture. This verifies our integration, NOT RUTUBE's media availability.
 * Run separately from a real-provider embed smoke test.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:5190';
const guestBase = process.argv[3] || base;
const first = '564f31c881b83373bfe0cb26979d44cf';
const second = '7716bd3e665725c3c008ae7ab4ff02e2';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const trace = [];
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#101216;color:white;display:grid;place-items:center;height:100vh;font:18px sans-serif"><span>Тест официального API RUTUBE</span><script>
const deferTimeline=false;
let loaded=false, time=0, paused=true, ad=false, blockPlay=false, quality='auto', volume=1, muted=false, controlsHidden=new URL(location.href).searchParams.get('hideControls')==='true';
const emit=(type,data={})=>parent.postMessage(JSON.stringify({type,data}),'*');
const levels=()=>emit('player:qualityList',{list:deferTimeline?['360','720','1080']:[360,720,1080]});
const state=()=>({time,paused,ad,quality,volume,muted,controlsHidden});
window.__fixture={state,advertising(on){ad=on;emit(on?'player:adStart':'player:adEnd');},permission(on){blockPlay=on;},nativePause(){paused=true;emit('player:changeState',{state:'pause'});},nativeSeek(value){time=value;emit('player:currentTime',{time});}};
addEventListener('message',event=>{let m;try{m=JSON.parse(event.data);}catch{return;}
 if(m.type==='player:play'&&!ad&&!blockPlay){if(!loaded){loaded=true;emit('player:durationChange',{duration:2669});levels();}paused=false;emit('player:changeState',{state:'playing'});}
 if(m.type==='player:pause'&&!ad){paused=true;emit('player:changeState',{state:'pause'});}
 if(m.type==='player:setCurrentTime'&&!ad){time=m.data.time;emit('player:currentTime',{time});}
 if(m.type==='player:changeQuality'){quality=m.data.quality;emit('player:currentQuality',{quality:{height:quality==='auto'?480:Number(quality),quality:quality==='auto'?'480':quality,isAutoQuality:quality==='auto'}});}
 if(m.type==='player:hideControls')controlsHidden=true;
 if(m.type==='player:setVolume'){volume=m.data.volume;emit('player:volumeChange',{volume:String(volume),muted});}
 if(m.type==='player:mute'||m.type==='player:unMute'){muted=m.type==='player:mute';emit('player:volumeChange',{volume:String(volume),muted});}
});
setTimeout(()=>{emit('player:ready');if(!deferTimeline){loaded=true;emit('player:durationChange',{duration:2669});levels();}emit('player:currentTime',{time});},100);
setInterval(()=>{if(!paused&&!ad)time+=.25;emit('player:currentTime',{time});},250);
</script></body></html>`;
async function viewer(name, viewport = { width: 1280, height: 800 }) {
	const context = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1' } : {}) });
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
	page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
		try { const m = JSON.parse(String(payload)); if (m.type === 'state') trace.push({ viewer: name, ...m }); } catch {}
	}));
	await page.route('https://rutube.ru/play/embed/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: name === 'guest' ? fixture.replace('const deferTimeline=false;', 'const deferTimeline=true;') : fixture }));
	if (viewport.width < 500) await page.addInitScript(() => {
		HTMLElement.prototype.requestFullscreen = async () => { throw new Error('Test mobile fallback'); };
		window.__testViewportHeight = null;
		Object.defineProperty(visualViewport, 'height', { get: () => window.__testViewportHeight ?? innerHeight });
	});
	return page;
}
const frame = (page) => page.frames().find((f) => f.url().startsWith('https://rutube.ru/play/embed/'));
const read = (page) => frame(page).evaluate(() => window.__fixture.state());
async function wait(page, predicate) {
	await page.waitForFunction(predicate, null, { timeout: 20_000 });
}
async function playing(page) {
	await frame(page).waitForFunction(() => !window.__fixture.state().paused, null, { timeout: 25_000 });
}
async function aligned(host, guest, phase) {
	await Promise.all([playing(host), playing(guest)]);
	await host.waitForTimeout(1000);
	const [a, b] = await Promise.all([read(host), read(guest)]);
	assert.ok(Math.abs(a.time - b.time) < 1.6, `${phase}: clocks aligned`);
	console.log(JSON.stringify({ phase, fixture: true, drift: Math.abs(a.time - b.time) }));
}
async function wakeControls(page) {
	const show = page.getByRole('button', { name: 'Показать управление', exact: true });
	if (await show.count()) await show.click();
}
async function control(page, label) {
	await wakeControls(page);
	await page.getByRole('button', { name: label, exact: true }).click();
}
async function chooseQuality(page, label) {
	await control(page, 'Качество RUTUBE');
	await page.getByRole('group', { name: 'Доступное качество видео' }).getByRole('button', { name: new RegExp(`^${label}(?: |$)`) }).click();
}
async function roomStarted() {
	for (let attempt = 0; attempt < 100; attempt++) {
		const state = trace.findLast((m) => m.viewer === 'guest');
		if (state && !state.paused && !state.waitingForReady && !state.sourcePending && state.anchorTs <= Date.now()) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.fail('Shared readiness barrier did not finish');
}
try {
	const host = await viewer('host');
	await host.goto(`${base}/rutube`, { waitUntil: 'domcontentloaded' });
	await host.getByLabel('Ссылка на видео RUTUBE').fill(`https://rutube.ru/video/${first}/`);
	await host.getByRole('button', { name: 'Открыть видео', exact: true }).click();
	await host.waitForURL(new RegExp(`/rutube/${first}/watch`));
	await host.getByLabel('Качество RUTUBE').waitFor();
	await chooseQuality(host, '1080p');
	assert.equal((await read(host)).quality, '1080');
	assert.ok((await read(host)).controlsHidden, 'One control bar, no native duplicate');
	await control(host, 'Громкость');
	await host.getByLabel('Громкость RUTUBE').evaluate((input) => { input.value = '0.35'; input.dispatchEvent(new Event('input', { bubbles: true })); });
	assert.equal((await read(host)).volume, .35);
	await host.getByRole('button', { name: 'Выключить звук', exact: true }).click();
	assert.ok((await read(host)).muted);
	await host.keyboard.press('Escape');
	await chooseQuality(host, 'Авто');
	await host.getByRole('button', { name: 'Смотреть вместе', exact: true }).click();
	await host.getByLabel('Ваше имя').fill('Ведущий RUTUBE');
	await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
	await host.waitForURL(/room=/);
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	const invite = await host.getByLabel('Ссылка-приглашение').inputValue();
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	const guest = await viewer('guest', { width: 390, height: 844 });
	await guest.goto(new URL(new URL(invite).pathname, guestBase).href, { waitUntil: 'domcontentloaded' });
	await guest.getByLabel('Как вас зовут?').fill('Друг с телефона');
	await guest.getByRole('button', { name: 'Присоединиться к просмотру' }).click();
	await guest.waitForURL(new RegExp(`/rutube/${first}/watch\\?room=`));
	await control(guest, 'Качество RUTUBE');
	await guest.getByText('Уровни качества появятся после запуска видео.', { exact: false }).waitFor();
	await guest.getByRole('button', { name: 'Закрыть настройки качества', exact: true }).click();
	await guest.getByRole('button', { name: 'Загрузить видео', exact: true }).click();
	await guest.getByLabel('Качество RUTUBE').waitFor();
	await host.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
	await aligned(host, guest, 'join-and-play');
	await control(guest, 'Пауза');
	await frame(host).waitForFunction(() => window.__fixture.state().paused);
	await frame(guest).waitForFunction(() => window.__fixture.state().paused);
	await host.getByLabel('Перемотка общего видео').evaluate((input) => { input.value = '45'; input.dispatchEvent(new Event('change', { bubbles: true })); });
	await frame(guest).waitForFunction(() => Math.abs(window.__fixture.state().time - 45) < 1);
	await host.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
	await aligned(host, guest, 'shared-pause-and-seek');
	await chooseQuality(guest, '720p');
	assert.equal((await read(guest)).quality, '720');
	assert.ok((await read(guest)).controlsHidden);
	assert.equal((await read(host)).quality, 'auto', 'Quality changes only the current viewer');
	await control(guest, 'Качество RUTUBE');
	await guest.waitForTimeout(3600);
	assert.ok(await guest.getByRole('region', { name: 'Настройки плеера RUTUBE' }).isVisible(), 'Quality menu does not auto-hide while being used');
	await guest.keyboard.press('Escape');
	await control(guest, 'Полный экран');
	await guest.getByRole('dialog', { name: 'Просмотр без адресной строки' }).getByRole('button', { name: 'Понятно', exact: true }).click();
	await control(guest, 'Открыть чат');
	assert.equal(await guest.locator('.rutube-room.page-fullscreen').count(), 1);
	assert.equal(await guest.getByLabel('Ссылка-приглашение').count(), 0);
	await guest.getByLabel('Сообщение в чат').fill('Привет из RUTUBE');
	await guest.getByRole('button', { name: 'Отправить', exact: true }).click();
	await host.getByRole('log').getByText('Привет из RUTUBE').waitFor();
	await guest.getByRole('button', { name: 'Реакция 😂', exact: true }).click();
	await Promise.all([host.getByLabel('Реакции участников').getByText('😂', { exact: true }).waitFor(), guest.getByLabel('Реакции участников').getByText('😂', { exact: true }).waitFor()]);
	await host.getByRole('button', { name: 'Реакция ❤️', exact: true }).click();
	await Promise.all([host.getByLabel('Реакции участников').getByText('❤️', { exact: true }).waitFor(), guest.getByLabel('Реакции участников').getByText('❤️', { exact: true }).waitFor()]);
	const chatHeight = await guest.getByLabel('Чат совместного просмотра').evaluate((panel) => panel.getBoundingClientRect().height);
	assert.ok(chatHeight < 320, 'Mobile chat does not take half the screen by default');
	await guest.getByRole('button', { name: 'Увеличить чат', exact: true }).click();
	assert.ok(await guest.getByLabel('Чат совместного просмотра').evaluate((panel) => panel.getBoundingClientRect().height) > chatHeight);
	await guest.getByRole('button', { name: 'Уменьшить чат', exact: true }).click();
	await guest.getByRole('button', { name: 'Ещё реакции', exact: true }).click();
	assert.equal(await guest.locator('.emoji-grid button').count(), 24);
	await guest.getByRole('button', { name: 'Реакция 🍿', exact: true }).click();
	await Promise.all([host.getByLabel('Реакции участников').getByText('🍿', { exact: true }).waitFor(), guest.getByLabel('Реакции участников').getByText('🍿', { exact: true }).waitFor()]);
	await guest.getByRole('button', { name: 'Открыть стикеры и GIF', exact: true }).click();
	await guest.getByRole('button', { name: 'Стикеры', exact: true }).click();
	await guest.getByRole('button', { name: 'Стикер Поцелуй', exact: true }).click();
	await Promise.all([host.getByLabel('Реакции участников').getByAltText('Поцелуй').waitFor(), guest.getByLabel('Реакции участников').getByAltText('Поцелуй').waitFor()]);
	const gif = { url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Cat_funny_gif.gif', title: 'Тестовый кот', author: 'Amrutha Unni', license: 'CC BY-SA 4.0' };
	await guest.route('**/api/party/gifs?*', (route) => route.fulfill({ json: { provider: 'Wikimedia Commons', results: [gif] } }));
	await guest.getByRole('button', { name: 'Открыть стикеры и GIF', exact: true }).click();
	await guest.getByRole('button', { name: 'GIF', exact: true }).click();
	await guest.getByLabel('Поиск GIF').fill('Коты');
	await guest.getByRole('button', { name: 'Отправить GIF Тестовый кот', exact: true }).click();
	await Promise.all([host.getByRole('log').getByAltText('Тестовый кот').waitFor(), guest.getByRole('log').getByAltText('Тестовый кот').waitFor()]);
	assert.ok((await host.getByRole('log').getByRole('link', { name: 'Тестовый кот ↗' }).getAttribute('href')).startsWith('https://commons.wikimedia.org/wiki/File:'));
	console.log(JSON.stringify({ phase: 'smaller-chat-24-reactions-stickers-gif-both-viewers', fixture: true }));
	await guest.screenshot({ path: join(tmpdir(), 'kihema-rutube-chat.png') });
	await guest.evaluate(() => { window.__testViewportHeight = 400; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.waitForTimeout(200);
	assert.ok(await guest.getByLabel('Сообщение в чат').evaluate((input) => input.getBoundingClientRect().bottom <= visualViewport.height + 1));
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.setViewportSize({ width: 320, height: 568 });
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await wakeControls(guest);
	assert.ok(await guest.getByRole('button', { name: 'Выйти из полного экрана', exact: true }).evaluate((button) => button.getBoundingClientRect().right <= innerWidth));
	await control(guest, 'Качество RUTUBE');
	assert.ok(await guest.getByRole('region', { name: 'Настройки плеера RUTUBE' }).evaluate((panel) => { const r = panel.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), 'Quality settings fit even at 320px with chat open');
	await guest.getByRole('button', { name: /^1080p/ }).click();
	assert.equal((await read(guest)).quality, '1080');
	await guest.setViewportSize({ width: 844, height: 390 });
	await guest.evaluate(() => { window.__testViewportHeight = innerHeight; visualViewport.dispatchEvent(new Event('resize')); });
	await guest.waitForTimeout(250);
	assert.ok(await guest.evaluate(() => document.querySelector('iframe').getBoundingClientRect().right <= document.querySelector('[aria-label="Чат совместного просмотра"]').getBoundingClientRect().left + 1));
	console.log(JSON.stringify({ phase: 'quality-mobile-fullscreen-chat-keyboard-reactions', fixture: true }));
	await frame(guest).evaluate(() => window.__fixture.advertising(true));
	await host.waitForTimeout(1000);
	assert.ok((await read(host)).paused, 'Guest advertisement pauses the host content');
	const frozen = (await read(host)).time;
	await host.waitForTimeout(1250);
	assert.equal((await read(host)).time, frozen);
	await frame(guest).evaluate(() => window.__fixture.advertising(false));
	await aligned(host, guest, 'resume-after-guest-ad');
	await roomStarted();
	await host.mouse.move(0, 799);
	await host.waitForTimeout(3600);
	assert.ok(await host.locator('.rutube-main').evaluate((main) => main.classList.contains('hud-hidden')), 'Title and navigation auto-hide during playback');
	await wakeControls(host);
	await host.waitForTimeout(300);
	assert.ok(await host.locator('.rutube-header').evaluate((header) => getComputedStyle(header).opacity !== '0'), 'Hidden controls can be reopened');
	await host.waitForTimeout(2100);
	await frame(host).evaluate(() => window.__fixture.nativePause());
	await frame(guest).waitForFunction(() => window.__fixture.state().paused);
	await host.waitForTimeout(2100);
	await frame(host).evaluate(() => window.__fixture.nativeSeek(90));
	await frame(guest).waitForFunction(() => Math.abs(window.__fixture.state().time - 90) < 1);
	await control(host, 'Воспроизвести');
	await aligned(host, guest, 'native-host-controls');
	await host.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
	await host.getByRole('button', { name: 'Видео RUTUBE', exact: true }).click();
	await host.getByLabel('Ссылка RUTUBE для комнаты').fill(`https://rutube.ru/video/${second}/`);
	await host.getByRole('button', { name: 'Включить всем', exact: true }).click();
	await Promise.all([host.waitForURL(new RegExp(`/rutube/${second}/watch`)), guest.waitForURL(new RegExp(`/rutube/${second}/watch`))]);
	await guest.getByRole('button', { name: 'Загрузить видео', exact: true }).click();
	await Promise.all([host.getByLabel('Качество RUTUBE').waitFor(), guest.getByLabel('Качество RUTUBE').waitFor()]);
	await aligned(host, guest, 'host-changes-video');
	await roomStarted();
	await control(host, 'Пауза');
	await frame(guest).waitForFunction(() => window.__fixture.state().paused);
	await frame(guest).evaluate(() => window.__fixture.permission(true));
	await control(host, 'Воспроизвести');
	await guest.getByRole('button', { name: 'Разрешить воспроизведение', exact: true }).waitFor({ timeout: 15_000 });
	assert.ok((await read(host)).paused, 'Autoplay permission waits for the other viewer');
	await frame(guest).evaluate(() => window.__fixture.permission(false));
	await guest.getByRole('button', { name: 'Разрешить воспроизведение', exact: true }).click();
	await aligned(host, guest, 'resume-after-autoplay-permission');
	assert.equal(errors.length, 0, errors.join('\n'));
	console.log(JSON.stringify({ ok: true, fixture: true, invite, errors, screenshot: join(tmpdir(), 'kihema-rutube-chat.png') }));
} catch (error) {
	console.error(JSON.stringify({ errors, recentStates: trace.slice(-10) }));
	throw error;
} finally { await browser.close(); }
