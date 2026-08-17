import { json, type RequestHandler } from '@sveltejs/kit';
import { config, tmdb } from '$lib/server/config';
import type { MediaType } from '$lib/types';

/**
 * Батч-выдача логотипов тайтлов.
 *
 * Зачем отдельный эндпоинт: TMDB не отдаёт `images.logos` в списочных ответах
 * (discover / trending / popular) — только в `/images` по одному тайтлу. Тянуть
 * их на сервере при отрисовке главной означало бы примерно 180 запросов к TMDB
 * на страницу, что упирается в их лимит и убивает время отклика.
 *
 * Поэтому карточки просят логотипы сами, батчами и только когда попали в кадр
 * (см. lib/logos.svelte.ts). Один батч — до 24 тайтлов, запросы к TMDB идут с
 * ограничением параллельности, результат кешируется в клиенте TMDB на сутки.
 */

/** Больше 24 за раз не берём: это уже похоже на выкачивание индекса. */
const MAX_IDS = 24;
/** Одновременных запросов к TMDB. Их soft-лимит около 40 в секунду. */
const CONCURRENCY = 8;

/** Простой пул: держит не больше `limit` задач в полёте. */
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out = new Array<R>(items.length);
	let cursor = 0;

	const worker = async () => {
		while (cursor < items.length) {
			const i = cursor++;
			out[i] = await fn(items[i]);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const type: MediaType = url.searchParams.get('type') === 'show' ? 'show' : 'movie';

	const ids = (url.searchParams.get('ids') ?? '')
		.split(',')
		.map((x) => Number.parseInt(x, 10))
		.filter((n) => Number.isFinite(n) && n > 0)
		.slice(0, MAX_IDS);

	if (!ids.length || config.demoMode || !tmdb) return json({});

	const client = tmdb;
	const results = await mapLimit(ids, CONCURRENCY, async (id) => {
		// Отказ по одному тайтлу не должен ронять весь батч: у части тайтлов
		// логотипов нет вовсе, и это нормальное состояние, а не ошибка.
		try {
			return await client.logo(type, id);
		} catch {
			return null;
		}
	});

	const payload: Record<string, string | null> = {};
	ids.forEach((id, i) => {
		payload[String(id)] = results[i];
	});

	// Логотипы у тайтла не меняются — пусть CDN подержит сутки.
	setHeaders({ 'cache-control': 'public, max-age=86400' });
	return json(payload);
};
