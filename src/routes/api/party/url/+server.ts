/**
 * Адрес WebSocket-сервера комнат для браузера.
 *
 * Сам браузер сходить на http://-discovery не может (страница https, mixed
 * content), поэтому проксируем здесь. Отдаём no-store: URL quick-туннеля
 * меняется при рестарте VPS, и CDN не должен его замораживать.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPartyServerUrl } from '$lib/server/config';

export const GET: RequestHandler = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const url = await getPartyServerUrl();
	if (!url) return json({ error: 'party-unavailable' }, { status: 503 });
	return json({ url });
};
