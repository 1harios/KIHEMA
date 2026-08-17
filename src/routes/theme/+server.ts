import { json, type RequestHandler } from '@sveltejs/kit';
import { THEMES, type Theme } from '$lib/types';

/** Смена темы: пишем cookie на год, класс на <html> ставит клиент сам. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const { theme } = (await request.json()) as { theme?: string };

	if (!theme || !(THEMES as readonly string[]).includes(theme)) {
		return json({ error: 'Неизвестная тема' }, { status: 400 });
	}

	cookies.set('theme', theme as Theme, {
		path: '/',
		maxAge: 31_536_000,
		sameSite: 'lax',
		httpOnly: false
	});
	return json({ ok: true });
};
