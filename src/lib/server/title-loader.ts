import { error, redirect } from '@sveltejs/kit';
import { getEpisodes, getTitle } from './catalog';
import { parseTmdbSlug, toMediaSlug } from '$lib/slug';
import type { MediaType } from '$lib/types';

export async function loadTitle(
	type: MediaType,
	slug: string,
	seasonParam: string | null,
	setHeaders?: (headers: Record<string, string>) => void,
	urlSearch = ''
) {
	const tmdbId = parseTmdbSlug(slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	const title = await getTitle(type, tmdbId);
	if (!title) error(404, 'Тайтл не найден');

	// Числовой ID позволяет принять старую ссылку с любым хвостом. После загрузки
	// названия закрепляем один канонический латинский URL для SEO и закладок.
	const canonicalSlug = toMediaSlug(title);
	if (slug !== canonicalSlug) {
		redirect(308, `/${type === 'movie' ? 'movie' : 'show'}/${canonicalSlug}${urlSearch}`);
	}

	// Для сериала сразу подгружаем серии выбранного сезона — иначе будет
	// вторая загрузка сразу после отрисовки, и список моргнёт.
	let season: number | null = null;
	let episodes: Awaited<ReturnType<typeof getEpisodes>> = [];

	if (type === 'show' && title.seasons.length) {
		const requested = Number.parseInt(seasonParam ?? '', 10);
		season = title.seasons.some((s) => s.seasonNumber === requested)
			? requested
			: title.seasons[0].seasonNumber;
		episodes = await getEpisodes(tmdbId, season);
	}

	// Детали тайтла меняются раз в сутки, а запрос самый тяжёлый в проекте
	// (append_to_response на одиннадцать ресурсов). Кеша здесь не было.
	setHeaders?.({ 'cache-control': 'public, max-age=600, stale-while-revalidate=86400' });

	return { title, season, episodes };
}
