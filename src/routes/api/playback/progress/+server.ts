import { json, type RequestHandler } from '@sveltejs/kit';
import { config, jellyfinAnon } from '$lib/server/config';
import { readSession } from '$lib/server/session';
import type { PlayMethod } from '$lib/types';

/**
 * Отчёты о просмотре. Именно событие `stopped` с финальной позицией сохраняет
 * прогресс — без него «продолжить смотреть» работать не будет.
 *
 * Отвечаем 204 всегда: если Jellyfin моргнул, ронять из-за этого воспроизведение
 * бессмысленно, потеряется в худшем случае отметка позиции.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json()) as {
		event: 'start' | 'progress' | 'stopped';
		itemId: string;
		playSessionId: string;
		mediaSourceId: string;
		positionSec: number;
		isPaused?: boolean;
		audioStreamIndex?: number;
		playMethod?: PlayMethod;
	};

	const session = readSession(cookies);
	if (config.demoMode || !session || !jellyfinAnon) return new Response(null, { status: 204 });

	const client = jellyfinAnon.withToken(session.jellyfinToken, session.deviceId);
	const common = {
		itemId: body.itemId,
		playSessionId: body.playSessionId,
		mediaSourceId: body.mediaSourceId,
		positionSec: body.positionSec
	};

	try {
		if (body.event === 'start') {
			await client.reportStart({
				...common,
				audioStreamIndex: body.audioStreamIndex,
				playMethod: body.playMethod ?? 'Transcode'
			});
		} else if (body.event === 'progress') {
			await client.reportProgress({
				...common,
				isPaused: Boolean(body.isPaused),
				audioStreamIndex: body.audioStreamIndex,
				playMethod: body.playMethod ?? 'Transcode'
			});
		} else {
			await client.reportStopped(common);
		}
	} catch (e) {
		console.warn('[playback] отчёт не доставлен:', e instanceof Error ? e.message : e);
	}

	return new Response(null, { status: 204 });
};
