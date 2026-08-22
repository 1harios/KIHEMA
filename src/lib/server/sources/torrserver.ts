/**
 * Торрент-источник: Jackett + Torrentio (поиск раздач) и TorrServer MatriX.143 (стриминг).
 *
 * Основной источник воспроизведения. Цепочка:
 *   1. Jackett ищет по названию из TMDB, Torrentio (Stremio-аддон) — по IMDb ID;
 *   2. лучшая раздача (сиды + размер) добавляется в TorrServer;
 *   3. gst-сборка TorrServer транскодирует файл в H.264/AAC HLS через cloudflared tunnel;
 *   4. браузер играет master.m3u8 напрямую — CORS у TorrServer открыт.
 */

import { config, tmdb } from '$lib/server/config';
import type { MediaType, PlaybackSource, ScrapeTarget, TorrentOption, Translation } from '$lib/types';

interface JackettResult {
	Title?: string;
	Size?: number;
	Seeders?: number;
	MagnetUri?: string;
	InfoHash?: string;
	/** Откуда пришёл результат — для пометки в списке раздач. */
	Source?: 'torrentio' | 'jackett';
}

interface TorrFile {
	id: number;
	path: string;
	length: number;
}

interface TorrListEntry {
	hash?: string;
	title?: string;
	/** JSON-строка: метаданные раздачи, файлы внутри .TorrServer.Files. */
	data?: string;
}

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Публичные анонсеры для голых magnet: метаданные приходят за секунды, а не минуты через DHT. */
const PUBLIC_TRACKERS = [
	'http://bt2.t-ru.org/ann?magnet',
	'udp://tracker.opentrackr.org:1337/announce',
	'udp://open.demonii.com:1337/announce',
	'udp://explodie.org:6969/announce'
];

const VIDEO_RE = /\.(mkv|mp4|avi|m4v|mov|webm|ts)$/i;
// Выбор конкретной серии в названии раздачи: "S01E02", "1x02", "серия 2",
// а для аниме — сквозной номер: "Bleach - 001".
const episodeInTitle = (name: string, s: number, e: number, abs?: number): boolean =>
	new RegExp(`s0?${s}[\\s._-]*e0?${e}\\b`, 'i').test(name) ||
	new RegExp(`\\b0?${s}x0?${e}\\b`).test(name) ||
	new RegExp(`сер[иияя]+\\s*0?${e}\\b`, 'i').test(name) ||
	(abs != null &&
		new RegExp(`(^|[\\s._\\[-])0*${abs}(?=$|[\\s._\\]])`).test(name));

/** Сезонные паки берём, только если раздачи с самой серией не нашлось. */
const seasonPackRe = (s: number): RegExp =>
	new RegExp(`(сезон[:\\s]*0?${s}\\b|0?${s}\\s*сезон\\b|s0?${s}\\b(?!\\s*e))`, 'i');

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

/**
 * Номера сезонов, упомянутые в названии раздачи: «сезон: 2», «1 сезон»,
 * «S02», «02x01». Диапазоны вроде «S01-S20» дают все числа диапазона.
 * Пустой список — сезон не упомянут, раздача проходит.
 */
function seasonsInTitle(name: string): number[] {
	const found = new Set<number>();
	for (const re of [
		/сезон[:\s]*0?(\d{1,2})\b/gi,
		/\b0?(\d{1,2})\s*сезон/gi,
		/\bs0?(\d{1,2})\b/gi,
		/\b0?(\d{1,2})x\d{2}\b/gi
	]) {
		for (const m of name.matchAll(re)) found.add(Number(m[1]));
	}
	return [...found];
}

/** Кандидаты в порядке убывания пригодности. Пусто — играть нечего. */
function rankedTorrents(results: JackettResult[], target: ScrapeTarget): JackettResult[] {
	const withMagnet = results.filter((r) => r.MagnetUri);
	if (!withMagnet.length) return [];

	const scored = withMagnet.map((r) => {
		const name = r.Title ?? '';
		const seeds = r.Seeders ?? 0;
		let score = Math.min(seeds, 50) * 2 + Math.log10(Math.max(r.Size ?? 0, 1));
		if (seeds === 0) score -= 100;

		// Русский звук важнее числа сидов: кириллица в названии — русская
		// раздача (RU-tracker стиль). Мертвую (0 сидов) не поднимаем — она всё
		// равно не подхватится. Явно нерусские озвучки (ITA/GER/…) опускаем,
		// иначе сиды выносят их на первое место.
		const cyrillic = /[а-яё]/i.test(name);
		if (cyrillic && seeds > 0) score += 120;
		else if (!cyrillic && /\b(ita|ger|fre|fra|spa|esp|pol)\b/i.test(name)) score -= 80;

		if (target.type === 'show') {
			const s = target.season ?? 1;
			const e = target.episode ?? 1;
			// Раздача явно про другой сезон («Сезон: 2» при запросе S01) —
			// брак: иначе плеер тихо покажет чужой сезон.
			const seasons = seasonsInTitle(name);
			if (seasons.length && !seasons.includes(s)) score -= 500;
			// Файл самой серии в разы меньше сезонного пака — старт быстрее.
			if (episodeInTitle(name, s, e, target.absEpisode)) score += 40;
			else if (seasonPackRe(s).test(name)) score += 10;
			else score -= 25;
		} else if (!VIDEO_RE.test(name)) {
			// У фильмов без расширения в названии внутри может оказаться что угодно.
			score -= 15;
		}
		// gst-эндпоинт TorrServer транскодирует только Matroska/WebM: раздача с
		// AVI/MP4 даст 502 «unsupported container» на любом запросе манифеста.
		// Расширение в названии бывает не всегда, поэтому это лишь порядок —
		// окончательный брак по контейнеру ставит pickVideoFile.
		if (/\.(avi|mp4|m4v|mov|ts)$/i.test(name)) score -= 200;
		else if (/\.(mkv|webm)$/i.test(name)) score += 25;
		return { r, score };
	});

	scored.sort((a, b) => b.score - a.score);
	return scored.map((s) => s.r);
}

/** Сквозной номер серии внутри сериала: для аниме-паков «Bleach - 001». */
async function absoluteEpisode(target: ScrapeTarget): Promise<number | null> {
	if (!tmdb) return null;
	try {
		const d = await tmdb.details('show', target.tmdbId);
		const s = target.season ?? 1;
		let abs = target.episode ?? 1;
		for (const season of d.seasons) {
			if (season.seasonNumber >= 1 && season.seasonNumber < s) abs += season.episodeCount;
		}
		return abs;
	} catch {
		return null;
	}
}

/* -------------------------------- Torrentio -------------------------------- */

/**
 * Torrentio (Stremio-аддон) ищет по IMDb ID и отдаёт раздачи со счётчиком
 * сидов — покрытие шире Jackett. Нужен только infoHash: магнет собираем сами.
 */
interface TorrentioStream {
	name?: string;
	title?: string;
	infoHash?: string;
}

const tokens = (s?: string | null): string[] =>
	(s ?? '')
		.toLowerCase()
		.split(/[^a-zа-яё0-9]+/i)
		.filter((w) => w.length > 2 && !/^\d+$/.test(w));

/**
 * Название раздачи точно про наш тайтл? Torrentio ищет по IMDb ID, но в выдаче
 * бывают созвучные фильмы (Legionnaires Trail рядом с The Legion): требуем,
 * чтобы в имени раздачи встретилось полное слово из названия. Jackett же ищет
 * по тексту и может притащить одноимённый фильм другого года (Одиссея 1997
 * вместо 2026) — при известном годе брак по нему отсеивается отдельно.
 */
function matchesTitle(
	name: string,
	titles: (string | null | undefined)[],
	year?: number
): boolean {
	const release = new Set(tokens(name));
	const titleOk = titles.some((t) => {
		const tw = tokens(t);
		if (!tw.length) return false;
		const longest = tw.reduce((a, b) => (b.length > a.length ? b : a));
		return release.has(longest);
	});
	if (!titleOk) return false;

	if (year) {
		const years = [...name.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
		if (years.length && !years.includes(year)) return false;
	}
	return true;
}

function parseSeeders(text?: string): number {
	const m = (text ?? '').match(/\uD83D\uDC64\s*[\uFE0F]?\s*(\d+)/u) ?? (text ?? '').match(/(\d+)\s*(?=seeds)/i);
	return m ? Number(m[1]) : 0;
}

async function torrentioSearch(target: ScrapeTarget, imdbId: string): Promise<JackettResult[]> {
	if (!config.torrents.torrentioEnabled) return [];

	// Сериалы адресуются суффиксом «:сезон:серия» после IMDb ID.
	const id =
		target.type === 'show'
			? `${imdbId}:${target.season ?? 1}:${target.episode ?? 1}`
			: imdbId;
	const res = await fetch(`${config.torrents.torrentioUrl}/stream/movie/${id}.json`, {
		headers: { accept: 'application/json', 'user-agent': UA },
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`Torrentio ответил ${res.status}`);
	const data = (await res.json()) as { streams?: TorrentioStream[] };

	return (data.streams ?? [])
		.filter((s): s is TorrentioStream & { infoHash: string } => Boolean(s.infoHash))
		.map((s) => {
			// Название раздачи в первой строке title; дальше — счётчики и трекеры.
			const title = (s.title ?? '').split('\n')[0];
			return {
				Title: title,
				Seeders: parseSeeders(s.title),
				MagnetUri: `magnet:?xt=urn:btih:${s.infoHash}`
			} satisfies JackettResult;
		});
}

/* ------------------------------- TorrServer ------------------------------- */

function parseFiles(data?: string): TorrFile[] {
	if (!data) return [];
	try {
		const parsed = JSON.parse(data) as { TorrServer?: { Files?: TorrFile[] } };
		return parsed.TorrServer?.Files ?? [];
	} catch {
		return [];
	}
}

/** Имя файла в раздаче может не совпадать с названием раздачи. */
function pickVideoFile(files: TorrFile[], target: ScrapeTarget): TorrFile | null {
	// gst-сборка TorrServer транскодирует только Matroska/WebM — прочие
	// контейнеры (AVI/MP4/TS) дают 502 «unsupported container» и не играбельны.
	const videos = files.filter((f) => /\.(mkv|webm)$/i.test(f.path));
	if (!videos.length) return null;

	if (target.type === 'show') {
		const e = target.episode ?? 1;
		const ep = videos.find((f) => episodeInTitle(f.path, target.season ?? 1, e, target.absEpisode));
		if (ep) return ep;
		// Пак без совпадения серии — молча подсунёт чужую серию (самый большой
		// файл не обязан быть нужной серией). Одиночный файл берём как есть.
		return videos.length === 1 ? videos[0] : null;
	}
	return videos.sort((a, b) => b.length - a.length)[0];
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
			{ signal: AbortSignal.timeout(8_000) }
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

/**
 * Ждём живой манифест, прежде чем отдавать поток браузеру.
 *
 * Возвращает ok только на настоящий 200. 5xx — холодный транскодер, греем
 * дальше до конца бюджета; 4xx и 502 с текстом «unsupported container» —
 * однозначный отказ, ждать бессмысленно.
 */
async function prewarmManifest(
	url: () => string,
	budgetMs = 90_000 // Увеличено с 12s до 90s для холодного старта TorrServer
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const startedAt = Date.now();
	for (;;) {
		try {
			const res = await fetch(url(), { signal: AbortSignal.timeout(5_000) });
			const text = await res.text().catch(() => '');
			if (res.ok) return { ok: true };
			const definitive =
				(res.status >= 400 && res.status < 500) ||
				/unsupported (container|video codec)/i.test(text);
			if (definitive) {
				return {
					ok: false,
					reason: `HTTP ${res.status}${text ? `: ${text.trim().slice(0, 120)}` : ''}`
				};
			}
		} catch {
			/* сетевой сбой/таймаут — продолжаем греть до конца бюджета */
		}
		if (Date.now() + 4_000 > startedAt + budgetMs) {
			return { ok: false, reason: 'нет 200 за отведённое время' };
		}
		await new Promise((r) => setTimeout(r, 3_000));
	}
}

/** Маркер раздач, добавленных вручную: «kinema:<тип>:<tmdbId>:…». */
const localMark = (target: ScrapeTarget): string => `kinema:${target.type}:${target.tmdbId}:`;

/** Локальная раздача тайтла из базы TorrServer, если есть. */
async function findLocalEntry(
	target: ScrapeTarget
): Promise<{ hash: string; title: string; data?: string } | null> {
	try {
		const res = await fetch(`${config.torrents.serverUrl}/torrents`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'list' }),
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return null;
		const list = (await res.json()) as TorrListEntry[];
		const mark = localMark(target);
		const entry = list.find((t) => (t.title ?? '').startsWith(mark) && t.hash);
		return entry
			? { hash: entry.hash!.toLowerCase(), title: entry.title ?? '', data: entry.data }
			: null;
	} catch {
		return null;
	}
}

/**
 * Локальная библиотека: раздачи, добавленные в TorrServer вручную с маркером
 * «kinema:<тип>:<tmdbId>:» в названии. Они уже в базе — трекеры искать не
 * нужно, источник берётся напрямую.
 */
async function localLibrarySource(target: ScrapeTarget): Promise<PlaybackSource | null> {
	const entry = await findLocalEntry(target);
	if (!entry) return null;
	const file = pickVideoFile(parseFiles(entry.data), target);
	if (!file) {
		console.warn(`[torrents] локальная раздача ${entry.hash}: играбельного файла нет`);
		return null;
	}
	console.warn(`[torrents] найдена локальная раздача: ${entry.hash}`);
	return buildSource(entry.hash, file, target);
}

/** Раздача уже в базе TorrServer (смотрели раньше) — источник без трекеров. */
async function sourceByHash(hash: string, target: ScrapeTarget): Promise<PlaybackSource | null> {
	try {
		const res = await fetch(`${config.torrents.serverUrl}/torrents`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'list' }),
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return null;
		const list = (await res.json()) as TorrListEntry[];
		const entry = list.find((t) => (t.hash ?? '').toLowerCase() === hash.toLowerCase());
		if (!entry) return null;
		const file = pickVideoFile(parseFiles(entry.data), target);
		if (!file) return null;
		return buildSource(hash.toLowerCase(), file, target);
	} catch {
		return null;
	}
}

/** Общий запрос списка раздач из базы TorrServer. */
async function fetchTorrentList(): Promise<TorrListEntry[]> {
	try {
		const res = await fetch(`${config.torrents.serverUrl}/torrents`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'list' }),
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return [];
		return (await res.json()) as TorrListEntry[];
	} catch {
		return [];
	}
}

/** Добавляет кандидата в TorrServer и возвращает его hash. */
async function addCandidate(cand: JackettResult, fallbackTitle: string): Promise<string | null> {
	if (!cand.MagnetUri) return null;
	// Голый магнет без трекеров надеется только на DHT — дописываем публичные
	// анонсеры, чтобы метаданные пришли за секунды.
	let link = cand.MagnetUri;
	if (link.startsWith('magnet:') && !/[?&]tr=/.test(link)) {
		link += PUBLIC_TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
	}
	try {
		const res = await fetch(`${config.torrents.serverUrl}/torrents`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': UA },
			body: JSON.stringify({
				action: 'add',
				link,
				title: cand.Title || fallbackTitle,
				save_to_db: true
			}),
			signal: AbortSignal.timeout(15_000)
		});
		if (!res.ok) return null;
		return resultHash(cand);
	} catch (error) {
		console.warn(
			'[torrents] не удалось добавить раздачу:',
			error instanceof Error ? error.message : error
		);
		return null;
	}
}

/** Уже добавленный в TorrServer торрент: ждём метаданные и собираем источник. */
async function tryPreparedCandidate(
	hash: string,
	target: ScrapeTarget
): Promise<PlaybackSource | null> {
	const h = hash.toLowerCase();
	for (let i = 0; i < 4; i++) {
		const entry = (await fetchTorrentList()).find(
			(t) => (t.hash ?? '').toLowerCase() === h
		);
		const file = entry ? pickVideoFile(parseFiles(entry.data), target) : null;
		if (file) return buildSource(h, file, target);
		await new Promise((r) => setTimeout(r, 2_500));
	}
	return null;
}

/** Убирает заведённые на время поиска раздачи, не трогая те, что были в базе. */
async function removeTorrents(hashes: string[], existing: Set<string>): Promise<void> {
	await Promise.all(
		[...new Set(hashes)]
			.filter((h) => h && !existing.has(h))
			.map((h) =>
				fetch(`${config.torrents.serverUrl}/torrents`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'rem', hash: h }),
					signal: AbortSignal.timeout(5_000)
				}).catch(() => {})
			)
	);
}

/* ------------------------- список раздач для выбора ------------------------ */

/** Раздача в списке выбора плеера. */
export type TorrOption = TorrentOption;

const qualityFromTitle = (t: string): string | null => {
	const m = t.match(/\b(2160p|1080p|720p|576p|480p)\b/i);
	if (m) return m[1].toLowerCase();
	if (/\b(4k|uhd)\b/i.test(t)) return '2160p';
	return null;
};

const resultHash = (r: JackettResult): string | null =>
	r.InfoHash?.toLowerCase() ??
	r.MagnetUri?.match(/btih:([a-z0-9]{40}|[a-z2-7]{32})/i)?.[1]?.toLowerCase() ??
	null;

const searchCache = new Map<string, { at: number; found: CandidateSearch }>();
const SEARCH_TTL_MS = 10 * 60 * 1000;
const searchKey = (t: ScrapeTarget) =>
	`${t.type}:${t.tmdbId}:${t.season ?? ''}x${t.episode ?? ''}`;

/**
 * Раздачи тайтла для выбора в плеере: локальная (если есть) + результаты
 * поиска. Поиск общий с torrentPlaybackSource и кешируется на 10 минут —
 * открытие меню и последующий выбор не дёргают трекеры заново.
 */
export async function listTorrentOptions(target: ScrapeTarget): Promise<TorrOption[]> {
	if (!config.torrents.enabled) return [];

	const options: TorrOption[] = [];

	// Локальная база и трекеры идут параллельно: меню открывается быстрее,
	// а медленный поиск не ждёт списка TorrServer и наоборот.
	const [local, found] = await Promise.all([
		findLocalEntry(target),
		searchCandidates(target).catch((e) => {
			console.warn('[torrents] поиск раздач не удался:', e instanceof Error ? e.message : e);
			return null;
		})
	]);

	if (local) {
		options.push({
			hash: local.hash,
			title: local.title.replace(localMark(target), '') || 'Локальная раздача',
			seeders: 0,
			source: 'local',
			quality: qualityFromTitle(local.title)
		});
	}

	for (const r of found?.candidates ?? []) {
		const hash = resultHash(r);
		if (!hash) continue;
		options.push({
			hash,
			title: r.Title ?? '',
			seeders: r.Seeders ?? 0,
			sizeMb: r.Size ? Math.round(r.Size / (1024 * 1024)) : undefined,
			source: r.Source ?? 'jackett',
			quality: qualityFromTitle(r.Title ?? '')
		});
	}
	return options;
}

/* ---------------------------------- поиск ---------------------------------- */

interface CandidateSearch {
	briefTitle: string;
	queries: string[];
	candidates: JackettResult[];
}

/** Torrentio + Jackett с фильтрами и ранжированием. Топ-8 кандидатов. */
async function searchCandidates(target: ScrapeTarget): Promise<CandidateSearch | null> {
	if (!tmdb) return null;

	const key = searchKey(target);
	const hit = searchCache.get(key);
	if (hit && hit.at + SEARCH_TTL_MS > Date.now()) return hit.found;

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

	// Torrentio идёт параллельно с Jackett: он ищет по IMDb ID и часто находит
	// то, чего на Jackett-трекерах нет (и наоборот).
	const imdbId = await tmdb.externalIds(target.type, target.tmdbId).then(
		(r) => r.imdbId,
		() => undefined
	);
	const torrentioPromise = imdbId
		? torrentioSearch(target, imdbId).catch((e) => {
				console.warn('[torrents] Torrentio не ответил:', e instanceof Error ? e.message : e);
				return [] as JackettResult[];
			})
		: Promise.resolve([] as JackettResult[]);

	const [torrentioResults, jackettResultsRaw] = await Promise.all([
		torrentioPromise,
		Promise.all(
			queries.map((q) =>
				jackettSearch(q).catch((e) => {
					console.warn(`[torrents] Jackett-поиск «${q}» не удался:`, e instanceof Error ? e.message : e);
					return [] as JackettResult[];
				})
			)
		).then((r) => r.flat())
	]);
	const jackettResults = jackettResultsRaw.map((r) => ({ ...r, Source: 'jackett' as const }));
	const torrentioTagged = torrentioResults.map((r) => ({ ...r, Source: 'torrentio' as const }));

	// Torrentio ищет по IMDb ID, но выдаёт и созвучные тайтлы (Legionnaires
	// Trail рядом с The Legion) — брак по названию и году. Jackett ищет по
	// тексту и может притащить одноимённый фильм другого года (Одиссея 1997
	// вместо 2026) — название там бывает транслитом, проверяем только год.
	const movieYear = target.type === 'movie' ? brief.year : undefined;
	const torrentioMatched = torrentioTagged.filter((r) =>
		matchesTitle(r.Title ?? '', [brief.title, brief.originalTitle], movieYear)
	);
	const jackettMatched = jackettResults.filter((r) => {
		if (!movieYear) return true;
		const years = [...(r.Title ?? '').matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
		return !years.length || years.includes(movieYear);
	});

	const results = [...torrentioMatched, ...jackettMatched];

	const seen = new Set<string>();
	const unique = results.filter((r) => {
		if (!r.MagnetUri) return false;
		// Одна раздача может прийти из обоих источников: сравниваем по infoHash.
		const key = resultHash(r) ?? r.MagnetUri;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const candidates = rankedTorrents(unique, target).slice(0, 8);
	if (!candidates.length) {
		console.warn(`[torrents] по «${queries.join('» / «')}» раздач не найдено (${results.length} ответов)`);
	}
	const found: CandidateSearch = { briefTitle: brief.title ?? '', queries, candidates };
	// Пустой результат часто значит «трекеры не ответили» — не кешируем, чтобы
	// следующий запрос попробовал снова, а не отдавал заглушку 10 минут.
	if (candidates.length) {
		if (searchCache.size > 200) {
			const oldest = searchCache.keys().next().value;
			if (oldest) searchCache.delete(oldest);
		}
		searchCache.set(key, { at: Date.now(), found });
	}
	return found;
}

/** Ищет тайтл в раздачах и заводит его в локальный TorrServer. */
export async function torrentPlaybackSource(
	target: ScrapeTarget,
	opts: { hash?: string } = {}
): Promise<PlaybackSource | null> {
	if (!config.torrents.enabled) {
		console.log('[torrents] disabled by config');
		return null;
	}
	if (!tmdb) {
		console.warn('[torrents] TMDB not configured — cannot search torrents');
		return null;
	}

	console.log(`[torrents] searching for ${target.type} ${target.tmdbId}...`);

	// Аниме со сквозной нумерацией («Bleach - 001»): считаем сквозной номер
	// серии, иначе файл внутри пака не совпадёт с «S01E01».
	if (target.type === 'show' && target.absEpisode == null) {
		const s = target.season ?? 1;
		const abs = s === 1 ? target.episode ?? 1 : await absoluteEpisode(target);
		if (abs != null) target = { ...target, absEpisode: abs };
	}

	// Раздача, явно выбранная в плеере. Обычно она уже в базе TorrServer
	// (тайтл смотрели) — тогда источник собирается мгновенно, без трекеров.
	if (opts.hash) {
		const direct = await sourceByHash(opts.hash, target);
		if (direct) return direct;
		console.warn(`[torrents] выбранной раздачи ${opts.hash} нет в базе — ищем на трекерах`);

		// Пользователь просил КОНКРЕТНУЮ раздачу: подменять её локальной из
		// библиотеки нельзя — иначе «сменил качество» тихо вернёт старую.
		const found = await searchCandidates(target);
		const wanted = found?.candidates.find(
			(c) => resultHash(c) === opts.hash!.toLowerCase()
		);
		if (!wanted) return null;
		const hash = await addCandidate(wanted, found!.briefTitle);
		if (!hash) return null;
		return tryPreparedCandidate(hash, target);
	}

	// Локальная библиотека быстрее трекеров, но поиск кешируется и нужен меню —
	// запускаем оба пути параллельно, локальную раздачу берём первой.
	const [local, found] = await Promise.all([
		localLibrarySource(target),
		searchCandidates(target)
	]);
	if (local) return local;
	if (!found || !found.candidates.length) {
		console.warn(`[torrents] no candidates found for tmdb ${target.tmdbId}`);
		return null;
	}

	const pool = found.candidates.slice(0, 8);
	console.log(`[torrents] ${pool.length} candidates to try — добавляем все параллельно`);

	// Снимок хешей, уже сидящих в базе: уборка в конце не должна трогать чужое.
	const before = new Set(
		(await fetchTorrentList()).map((t) => (t.hash ?? '').toLowerCase()).filter(Boolean)
	);

	// Метаданные TorrServer тянет сам после add — заводим всех кандидатов сразу,
	// потом опрашиваем готовность одним запросом списка вместо N последовательных.
	const added = await Promise.all(
		pool.map(async (cand, i) => ({ i, hash: await addCandidate(cand, found.briefTitle) }))
	);
	const pending = new Set(added.map((a) => a.hash).filter((h): h is string => Boolean(h)));
	if (!pending.size) {
		console.warn('[torrents] ни одного кандидата не удалось добавить в TorrServer');
		return null;
	}

	const ready: { hash: string; file: TorrFile }[] = [];
	const failed: string[] = [];
	const deadline = Date.now() + 12_000;
	for (;;) {
		const list = await fetchTorrentList();
		for (const hash of [...pending]) {
			const entry = list.find((t) => (t.hash ?? '').toLowerCase() === hash);
			if (!entry) {
				// Раздача выпала из списка — TorrServer не смог её подхватить.
				pending.delete(hash);
				failed.push(hash);
				continue;
			}
			const files = parseFiles(entry.data);
			const file = pickVideoFile(files, target);
			if (file) {
				pending.delete(hash);
				ready.push({ hash, file });
				console.log(`[torrents] метаданные готовы: ${hash.substring(0, 8)}`);
			} else if (files.length) {
				// Метаданные пришли, но играбельного файла для серии нет — брак,
				// ждать дальше бессмысленно.
				pending.delete(hash);
				failed.push(hash);
			}
		}
		if (ready.length || !pending.size || Date.now() > deadline) break;
		await new Promise((r) => setTimeout(r, 2_500));
	}

	// Прогрев gst — строго по очереди (транскодер один), но в порядке рейтинга.
	const order = new Map(added.map((a) => [a.hash ?? '', a.i]));
	ready.sort((a, b) => (order.get(a.hash) ?? 99) - (order.get(b.hash) ?? 99));
	console.log(
		`[torrents] метаданные: ${ready.length} готово, ${pending.size} не дождались, ${failed.length} мертвы`
	);

	for (const { hash, file } of ready) {
		const source = await buildSource(hash, file, target);
		if (source) {
			const ours = [...failed, ...pending, ...ready.map((r) => r.hash)].filter(
				(h) => h !== hash
			);
			await removeTorrents(ours, before);
			return source;
		}
	}

	console.warn(`[torrents] ${ready.length} раздач с метаданными не дали поток`);
	await removeTorrents([...failed, ...pending], before);
	return null;
}

/** Прогревает манифест раздачи и собирает из неё PlaybackSource. */
async function buildSource(
	hash: string,
	file: TorrFile,
	target: ScrapeTarget
): Promise<PlaybackSource | null> {
	const epKey =
		target.type === 'show'
			? `${target.season ?? 1}x${target.episode ?? 1}`
			: 'movie';

	const urlFor = (audio: number) =>
		`${config.torrents.serverUrl}/gst/${hash}/master.m3u8?index=${file.id}&audio=${audio}`;

	console.log(`[torrents] warming up torrent ${hash.substring(0, 8)}...`);

	// Прогрев: первый запрос манифеста поднимает транскодер и предзагрузку.
	// Холодный gst отвечает 502/504, пока транскодер не поднимется (десятки
	// секунд), а у ошибки нет CORS-заголовков — браузер видит глухой
	// net::ERR_FAILED. Поэтому ждём настоящий 200 до конца бюджета и отдаём
	// браузеру только заведомо живой манифест.
	// Увеличиваем timeout до 60 сек на прогрев.
	const warmed = await Promise.race([
		prewarmManifest(() => urlFor(0)),
		new Promise<{ ok: false; reason: string }>((_, reject) =>
			setTimeout(() => reject(new Error('[torrents] manifest warmup timeout')), 60_000)
		)
	]);

	if (!warmed.ok) {
		console.warn(`[torrents] ${hash}: gst не отдал манифест (${warmed.reason})`);
		return null;
	}

	console.log(`[torrents] ${hash}: manifest ready, probing audio tracks...`);

	// Каждая аудиодорожка MKV — отдельная «озвучка»: у gst свой поток на
	// дорожку через audio=N. Манифест к этому моменту прогрет, но discoverer
	// всё равно может не успеть — тогда остаёмся с дорожкой по умолчанию.
	const audios = await Promise.race([
		probeAudioTracks(hash, file.id),
		new Promise<any[]>(() =>
			setTimeout(() => {
				console.warn(`[torrents] ${hash}: audio tracks timeout, using default track`);
				return [];
			}, 10_000)
		)
	]);

	const trackCount = audios?.length ?? 1;
	console.log(`[torrents] ${hash}: found ${trackCount} audio track(s)`);

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

/** Включены ли торренты — от этого зависит «играбельность» каталога. */
export const torrentsEnabled = (): boolean => config.torrents.enabled;

