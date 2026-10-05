// Raster exports of the existing code-native SVG mark, not a new generated logo.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	const svg = readFileSync('static/favicon.svg', 'utf8').replace(/width="32" height="32"/, 'width="100%" height="100%"');
	for (const size of [192, 512]) {
		const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
		await page.setContent(`<html><body style="margin:0;background:#08090b;width:100vw;height:100vh;display:grid;place-items:center"><div style="width:72%;height:72%">${svg}</div></body></html>`);
		await page.screenshot({ path: `static/app-icon-${size}.png` });
		await page.close();
	}
} finally { await browser.close(); }
