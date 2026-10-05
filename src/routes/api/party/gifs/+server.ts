import { json } from '@sveltejs/kit';
import { searchPartyGifs } from '$lib/server/party-gifs';
import type { RequestHandler } from './$types';

const visits = new Map<string, { start: number; count: number }>();
export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	const q = url.searchParams.get('q') || 'cat';
	if (q.length > 80) return json({ error: 'Запрос должен быть не длиннее 80 символов' }, { status: 400 });
	const ip = getClientAddress();
	const now = Date.now();
	if (visits.size >= 1000 && !visits.has(ip)) {
		for (const [key, value] of visits) if (now - value.start > 60_000) visits.delete(key);
		if (visits.size >= 1000) return json({ error: 'Поиск занят. Попробуйте через минуту.' }, { status: 429, headers: { 'Retry-After': '60' } });
	}
	let visit = visits.get(ip);
	if (!visit || now - visit.start > 60_000) { visit = { start: now, count: 0 }; visits.set(ip, visit); }
	if (++visit.count > 30) return json({ error: 'Слишком много запросов. Попробуйте через минуту.' }, { status: 429, headers: { 'Retry-After': '60' } });
	if (visits.size > 1000) for (const [key, value] of visits) if (now - value.start > 60_000) visits.delete(key);
	try { return json({ provider: 'Wikimedia Commons', results: await searchPartyGifs(q) }, { headers: { 'Cache-Control': 'private, max-age=60' } }); }
	catch { return json({ error: 'Поиск GIF сейчас недоступен. Попробуйте ещё раз.' }, { status: 502 }); }
};
