import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { config, jellyfinAnon } from '$lib/server/config';
import { newDeviceId, setSessionCookie } from '$lib/server/session';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { demoMode: config.demoMode, configured: Boolean(jellyfinAnon) };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!username) return fail(400, { message: 'Введите имя пользователя', username });
		if (!jellyfinAnon) return fail(503, { message: 'Jellyfin не настроен в .env', username });

		try {
			const auth = await jellyfinAnon.authenticate(username, password);

			// DeviceId должен быть стабильным на устройство: Jellyfin ведёт по нему
			// список сессий, а новый id на каждый вход плодит мусорные устройства.
			const deviceId = cookies.get('ls_device') ?? newDeviceId();
			cookies.set('ls_device', deviceId, {
				path: '/',
				maxAge: 31_536_000,
				httpOnly: true,
				sameSite: 'lax'
			});

			setSessionCookie(cookies, {
				jellyfinToken: auth.token,
				userId: auth.userId,
				userName: auth.userName,
				isAdmin: auth.isAdmin,
				deviceId
			});
		} catch {
			return fail(401, { message: 'Неверные имя пользователя или пароль', username });
		}

		redirect(303, '/');
	}
};
