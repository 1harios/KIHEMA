import { error, json, type RequestHandler } from '@sveltejs/kit';
import { config as siteConfig } from '$lib/server/config';
import { listTorrentOptions } from '$lib/server/sources/torrserver';
import type { MediaType } from '$lib/types';

/**
 * Список раздач тайтла для ручного выбора в плеере (смена раздачи/качества).
 * Только когда торрент-источник включён; иначе плеер секцию просто не покажет.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!siteConfig.torrents.enabled) error(503, 'Торрент-источник выключен');

	const body = (await request.json()) as {
		type: MediaType;
		tmdbId: number;
		season?: number;
		episode?: number;
	};
	if (!body?.tmdbId || !body?.type) error(400, 'Не переданы type и tmdbId');
	if (body.type === 'show' && (body.season == null || body.episode == null)) {
		error(400, 'Для сериала нужны season и episode');
	}

	const options = await listTorrentOptions({
		type: body.type,
		tmdbId: body.tmdbId,
		season: body.season,
		episode: body.episode
	});
	return json({ options });
};

/** Поиск раздач у трекеров бывает медленным. */
export const config = { maxDuration: 60 };
