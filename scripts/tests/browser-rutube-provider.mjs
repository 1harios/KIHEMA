/** Real official iframe, no media extraction and no API fixture. */
import { chromium } from 'playwright';
const base = process.argv[2] || 'https://kihema.93-123-84-128.sslip.io';
const id = process.argv[3] || '564f31c881b83373bfe0cb26979d44cf';
if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid video ID');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
	const page = await browser.newPage();
	await page.addInitScript(() => {
		window.__rutubeEvents = [];
		addEventListener('message', (event) => {
			if (event.origin !== 'https://rutube.ru') return;
			try {
				const m = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
				if (!m?.type?.startsWith('player:')) return;
				window.__rutubeEvents.push({ type: m.type, time: m.data?.time, duration: m.data?.duration, state: m.data?.state });
			} catch {}
		});
	});
	await page.goto(`${base}/rutube/${id}/watch`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.__rutubeEvents.some((e) => e.type === 'player:ready'), null, { timeout: 30_000 });
	await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click().catch(() => {});
	await page.waitForFunction(() => window.__rutubeEvents.some((e) => e.type === 'player:currentTime' && e.time > 0), null, { timeout: 28_000 }).catch(() => {});
	const events = await page.evaluate(() => window.__rutubeEvents);
	const iframe = page.frames().find((frame) => frame.url().startsWith('https://rutube.ru/play/embed/'));
	const providerText = await iframe?.locator('body').innerText({ timeout: 3000 }).catch(() => '');
	const status = await page.locator('.rutube-status').innerText();
	const playing = events.some((e) => e.type === 'player:currentTime' && e.time > 0);
	console.log(JSON.stringify({ base, id, playing, iframeReady: true, events: events.slice(-15), status, providerText: providerText?.slice(0, 700) }));
	if (!playing) process.exitCode = 2; // Provider unavailable, not a passed media test.
} finally { await browser.close(); }
