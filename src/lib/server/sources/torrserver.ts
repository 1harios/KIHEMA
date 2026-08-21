/**
 * Торрент-источник: Jackett (поиск раздач) + локальный TorrServer (стриминг).
 *
 * Запасной путь для тайтлов, которых нет в играбельных CDN. Цепочка:
 *   1. Jackett-совместимый API ищет раздачу по названию из TMDB;
 *   2. лучшая раздача (сиды + размер) добавляется в TorrServer;
 *   3. gst-сборка TorrServer транскодирует файл в H.264/AAC HLS;
 *   4. браузер играет master.m3u8 напрямую — CORS у TorrServer открыт.
 *
 * Локальный по природе: браузер ходит на 127.0.0.1, поэтому источник имеет
 * смысл только при dev-сервере на той же машине. На Vercel он выключен и
 * цепочку не задерживает.
 */

import { config, tmdb } from '$lib/server/config';
import type { MediaType, PlaybackSource, Translation } from '$lib/types';
import type { ScrapeTarget } from './lightstream';

interface JackettResult {
	Title?: string;
	Size?: number;
	Seeders?: number;
	MagnetUri?: string;
	InfoHash?: string;
}

interface TorrFile {
	id: number;
	path: string;
	length: number;
}

interface TorrListEntry {
	hash?: string;
	/** JSON-строка: метаданные раздачи, файлы внутри .TorrServer.Files. */
	data?: string;
}

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VIDEO_RE = /\.(mkv|mp4|avi|m4v|mov|webm|ts)$/i;
// Выбор конкретной серии в названии раздачи: "S01E02", "1x02", "серия 2".
const episodeInTitle = (name: string, s: number, e: number): boolean =>
	new RegExp(`s0?${s}\\s*e0?${e}\\b`, 'i').test(name) ||
	new RegExp(`\\b0?${s}x0?${e}\\b`).test(name) ||
	new RegExp(`сер[иияя]+\\s*0?${e}\\b`, 'i').test(name);

/** Сезонные паки берём, только если раздачи с самой серией не нашлось. */
const seasonPackRe = (s: number): RegExp =>
	new RegExp(`(сезон\\s*0?${s}\\b|s0?${s}\\b(?!\\s*e))`, 'i');

/* --------------------------------- Jackett -------------------------------- */

async function jackettSearch(query: string): Promise<JackettResult[]> {
	const u = new URL(
		`${config.torrents.jackettUrl}/api/v2.0/indexers/all/results`
	);
	u.searchParams.set('Query', query);
	if (config.torrents.jackettApiKey) u.searchParams.set('apikey', config.torrents.jackettApiKey);

	const res = await fetch(u, {
		headers: { accept: 'application/json', 'user-agent': UA },
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`Jackett ответил ${res.status}`);
	const data = (await res.json()) as { Results?: JackettResult[] };
	return data.Results ?? [];
}

function pickTorrent(results: JackettResult[], target: ScrapeTarget): JackettResult | null {
	const withMagnet = results.filter((r) => r.MagnetUri);
	if (!withMagnet.length) return null;

	const scored = withMagnet.map((r) => {
		const name = r.Title ?? '';
		const seeds = r.Seeders ?? 0;
		let score = Math.min(seeds, 50) * 2 + Math.log10(Math.max(r.Size ?? 0, 1));
		if (seeds === 0) score -= 100;

		if (target.type === 'show') {
			const s = target.season ?? 1;
			const e = target.episode ?? 1;
			// Файл самой серии в разы меньше сезонного пака — старт быстрее.
			if (episodeInTitle(name, s, e)) score += 40;
			else if (seasonPackRe(s).test(name)) score += 10;
			else score -= 25;
		} else if (!VIDEO_RE.test(name)) {
			// У фильмов без расширения в названии внутри может оказаться что угодно.
			score -= 15;
		}
		return { r, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored[0]?.r ?? null;
}

/* ------------------------------- TorrServer ------------------------------- */

/**
 * Файлы раздачи. action:"stat" у MatriX отвечает пусто — файлы приходят только
 * в action:"list" внутри сериализованного поля data.
 */
async function torrentFiles(hash: string): Promise<TorrFile[]> {
	const res = await fetch(`${config.torrents.serverUrl}/torrents`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action: 'list' }),
		signal: AbortSignal.timeout(5_000)
	});
	if (!res.ok) return [];
	const list = (await res.json()) as TorrListEntry[];
	const entry = list.find((t) => (t.hash ?? '').toLowerCase() === hash);
	if (!entry?.data) return [];
	try {
		const parsed = JSON.parse(entry.data) as { TorrServer?: { Files?: TorrFile[] } };
		return parsed.TorrServer?.Files ?? [];
	} catch {
		return [];
	}
}

/** Имя файла в раздаче может не совпадать с названием раздачи. */
function pickVideoFile(files: TorrFile[], target: ScrapeTarget): TorrFile | null {
	const videos = files.filter((f) => VIDEO_RE.test(f.path));
	if (!videos.length) return null;

	if (target.type === 'show') {
		const e = target.episode ?? 1;
		const ep = videos.find((f) => episodeInTitle(f.path, target.season ?? 1, e));
		if (ep) return ep;
	}
	// gst-сборка TorrServer транскодирует только Matroska/WebM; AVI/MP4 она
	// отвергает, поэтому MKV строго выше остальных контейнеров.
	const containerRank = (p: string) => (/\.(mkv|webm)$/i.test(p) ? 0 : 1);
	return videos.sort(
		(a, b) => containerRank(a.path) - containerRank(b.path) || b.length - a.length
	)[0];
}

/* ------------------------------ аудиодорожки ------------------------------ */

interface ProbeTrack {
	Type: string;
	Title?: string;
	Language?: string;
}

const LANG_NAMES: Record<string, string> = {
	ru: 'Русский',
	en: 'Английский',
	uk: 'Украинский',
	de: 'Немецкий',
	fr: 'Французский',
	es: 'Испанский',
	it: 'Итальянский',
	ja: 'Японский',
	ko: 'Корейский',
	zh: 'Китайский'
};

/**
 * Состав дорожек файла. gst-эндпоинт probe возвращает видео/аудио/субтитры с
 * языками — из него строится список «озвучек» (параметр audio=N у master.m3u8).
 */
async function probeAudioTracks(hash: string, fileId: number): Promise<ProbeTrack[] | null> {
	try {
		const res = await fetch(
			`${config.torrents.serverUrl}/gst/${hash}/probe?index=${fileId}`,
			{ signal: AbortSignal.timeout(10_000) }
		);
		if (!res.ok) return null;
		const probe = (await res.json()) as { Tracks?: ProbeTrack[] };
		const audios = (probe.Tracks ?? []).filter((t) => t.Type === 'audio');
		return audios.length ? audios : null;
	} catch {
		return null;
	}
}

/* ---------------------------------- API ----------------------------------- */

/** Ищет тайтл в раздачах и заводит его в локальный TorrServer. */
export async function torrentPlaybackSource(
	target: ScrapeTarget
): Promise<PlaybackSource | null> {
	if (!config.torrents.enabled || !tmdb) return null;

	const brief = await tmdb.brief(target.type, target.tmdbId).catch(() => null);
	if (!brief) {
		console.warn('[torrents] TMDB не отдал название тайтла — поиск раздач невозможен');
		return null;
	}

	// Русские трекеры индексируют локализованные названия, западные — оригинал:
	// ищем по обоим параллельно и склеиваем без дубликатов по magnet.
	const queries = [...new Set([brief.title, brief.originalTitle])]
		.filter((t): t is string => Boolean(t))
		.map((t) => (target.type === 'movie' && brief.year ? `${t} ${brief.year}` : t));

	const results = (
		await Promise.all(
			queries.map((q) =>
				jackettSearch(q).catch((e) => {
					console.warn(`[torrents] Jackett-поиск «${q}» не удался:`, e instanceof Error ? e.message : e);
					return [] as JackettResult[];
				})
			)
		)
	).flat();

	const seen = new Set<string>();
	const unique = results.filter((r) => {
		if (!r.MagnetUri || seen.has(r.MagnetUri)) return false;
		seen.add(r.MagnetUri);
		return true;
	});

	const best = pickTorrent(unique, target);
	if (!best?.MagnetUri) {
		console.warn(`[torrents] по «${queries.join('» / «')}» раздач не найдено (${results.length} ответов)`);
		return null;
	}
	console.warn(
		`[torrents] выбрана раздача «${best.Title}» (сиды: ${best.Seeders ?? 0})`
	);

	// save_to_db: true — иначе раздача не переживает stat/list и стрим не поднять.
	const addRes = await fetch(`${config.torrents.serverUrl}/torrents`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			action: 'add',
			link: best.MagnetUri,
			title: best.Title ?? brief.title,
			save_to_db: true
		}),
		signal: AbortSignal.timeout(15_000)
	});
	if (!addRes.ok) throw new Error(`TorrServer не принял раздачу: ${addRes.status}`);
	const added = (await addRes.json()) as { hash?: string };
	const hash = (added.hash ?? '').toLowerCase();
	if (!hash) throw new Error('TorrServer не вернул hash раздачи');

	// Метаданные читаются из пиров — до 30 секунд на «холодной» раздаче.
	let file: TorrFile | null = null;
	for (let i = 0; i < 20 && !file; i++) {
		file = pickVideoFile(await torrentFiles(hash), target);
		if (!file) await new Promise((r) => setTimeout(r, 1_500));
	}
	if (!file) {
		console.warn(`[torrents] ${hash}: видеофайл в раздаче не появился за 30 секунд`);
		// Раздача без видеофайла бесполезна — убираем, чтобы не засорять базу.
		await fetch(`${config.torrents.serverUrl}/torrents`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'rem', hash })
		}).catch(() => {});
		return null;
	}

	const epKey =
		target.type === 'show'
			? `${target.season ?? 1}x${target.episode ?? 1}`
			: 'movie';

	// Каждая аудиодорожка MKV — отдельная «озвучка»: у gst свой поток на
	// дорожку через audio=N. probe на только что добавленном файле может не
	// успеть (gst-discoverer обрывается, пока данные не прогреются) — один
	// повтор; нет ответа и после него — остаёмся с дорожкой по умолчанию.
	let audios = await probeAudioTracks(hash, file.id);
	if (!audios) {
		await new Promise((r) => setTimeout(r, 4_000));
		audios = await probeAudioTracks(hash, file.id);
	}
	const trackCount = audios?.length ?? 1;
	const urlFor = (audio: number) =>
		`${config.torrents.serverUrl}/gst/${hash}/master.m3u8?index=${file.id}&audio=${audio}`;

	const translations: Translation[] = Array.from({ length: trackCount }, (_, i) => {
		const track = audios?.[i];
		const trackName =
			track?.Title || LANG_NAMES[track?.Language ?? ''] || `Дорожка ${i + 1}`;
		return {
			id: `torrent:${hash}:${file.id}:${i}`,
			audioStreamIndex: i,
			label: `Торрент · ${trackName}`,
			isDefault: i === 0,
			url: urlFor(i),
			manifest: 'hls'
		};
	});

	return {
		jellyfinItemId: `torrent:${target.type}:${target.tmdbId}:${epKey}`,
		mediaSourceId: hash,
		playSessionId: `torrent-${target.tmdbId}-${epKey}`,
		streamUrl: urlFor(0),
		// TorrServer сам транскодирует на лету; для плеера поток уже готов.
		playMethod: 'DirectPlay',
		durationSec: 0,
		startPositionSec: 0,
		translations,
		activeTranslationId: translations[0].id,
		subtitles: [],
		segments: []
	};
}
