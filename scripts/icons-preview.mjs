/**
 * Раскладка всех жанровых иконок в крупном размере.
 *
 * Нужна потому, что в интерфейсе иконка жанра живёт при 22px, и на этом размере
 * невозможно понять, что нарисовано: военный шлем читался как крышка для блюда,
 * а шляпа вестерна — как колокол. Здесь они по 56px рядом друг с другом, и такие
 * ошибки видно сразу.
 *
 * Пути достаются из <script module> текстом и вычисляются eval: разбирать
 * Svelte-компонент ради превью не стоит, а PATHS — литерал без выражений.
 * Скрипт вспомогательный, в сборку не попадает.
 *
 * Запуск: node scripts/icons-preview.mjs -> /tmp/shots/genre-icons.png
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/components/ui/Icon.svelte', 'utf8');
// Достаём объект PATHS из <script module> без исполнения Svelte.
const body = src.slice(src.indexOf('const PATHS = {') + 'const PATHS = '.length);
const obj = body.slice(0, body.indexOf('} as const') + 1);
const PATHS = eval(`(${obj})`);

const names = Object.keys(PATHS).filter((n) => n.startsWith('genre'));
const svg = (n) => `
<figure>
  <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#e8ecf3"
       stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    ${PATHS[n].map((d) => `<path d="${d}"/>`).join('')}
  </svg>
  <figcaption>${n.replace('genre', '')}</figcaption>
</figure>`;

const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#0a0b0d;color:#9aa3af;font:12px/1.4 system-ui;display:grid;
grid-template-columns:repeat(7,1fr);gap:18px;padding:24px;margin:0}
figure{margin:0;display:grid;justify-items:center;gap:8px;padding:14px 6px;
border:1px solid #22252b;border-radius:10px}
</style>${names.map(svg).join('')}`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
await p.setContent(html);
await p.screenshot({ path: '/tmp/shots/genre-icons.png', fullPage: true });
await b.close();
console.log(names.length, 'иконок');
