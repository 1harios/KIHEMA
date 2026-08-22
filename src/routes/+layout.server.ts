import type { LayoutServerLoad } from './$types';
import { config } from '$lib/server/config';
import { torrentsEnabled } from '$lib/server/sources/torrserver';
import { archiveCount } from '$lib/server/archive';

export const load: LayoutServerLoad = async ({ locals }) => {
	const torrents = !config.demoMode && torrentsEnabled();

	return {
		user: locals.user,
		theme: locals.theme,
		demoMode: locals.demoMode,
		libraryConnected: locals.libraryConnected,
		scrapersEnabled: false, // CDN-скраперы удалены
		/**
		 * Сколько тайтлов реально можно включить помимо медиатеки.
		 *
		 * Нужно интерфейсу, чтобы «Нет в медиатеке» не выглядело поломкой: если
		 * источник воспроизведения не подключён вообще, надпись должна объяснять
		 * причину, а не констатировать факт.
		 */
		archiveCount,
		/** Ни медиатеки, ни внешних источников — смотреть можно только архив. */
		noPlaybackSource: !locals.demoMode && !locals.libraryConnected && !torrents
	};
};
