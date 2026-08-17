import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEpisodes, getTitleBrief } from '$lib/server/catalog';
import { parseTmdbSlug } from '$lib/slug';

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const tmdbId = parseTmdbSlug(params.slug);
	if (!tmdbId) error(404, 'Некорректный адрес');

	const season = Number.parseInt(url.searchParams.get('s') ?? '1', 10);
	const episode = Number.parseInt(url.searchParams.get('e') ?? '1', 10);
	if (!Number.isFinite(season) || !Number.isFinite(episode)) error(400, 'Некорректные номера');

	// Краткий запрос вместо полных деталей — см. страницу фильма. Список серий
	// идёт параллельно: последовательно это две круговые задержки подряд.
	const [title, episodes] = await Promise.all([
		getTitleBrief('show', tmdbId),
		getEpisodes(tmdbId, season)
	]);
	if (!title) error(404, 'Сериал не найден');
	const current = episodes.find((e) => e.episodeNumber === episode);
	if (!current?.inLibrary) error(404, 'Серии нет в медиатеке');

	// Следующая серия — для автоперехода в конце.
	const next = episodes.find((e) => e.episodeNumber === episode + 1 && e.inLibrary);

	setHeaders({ 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' });

	return {
		target: { type: 'show' as const, tmdbId, season, episode },
		context: {
			title: title.title,
			type: 'show' as const,
			tmdbId,
			seasonNumber: season,
			episodeNumber: episode,
			episodeTitle: current.name,
			nextEpisode: next
				? { seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber, name: next.name }
				: undefined
		},
		art: { backdrop: title.backdrop, poster: title.poster },
		backHref: `/show/${params.slug}?season=${season}`
	};
};
