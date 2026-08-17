#!/usr/bin/env node
/**
 * Сборка индекса фильмов из Internet Archive.
 *
 * Зачем нужен отдельный шаг сборки: сопоставление с TMDB требует сотни запросов,
 * делать их на старте приложения нельзя — на serverless индекс не переживёт
 * холодный старт, а пользователь будет ждать. Поэтому индекс собирается заранее
 * и уезжает в деплой обычным JSON-файлом.
 *
 * Сопоставление с TMDB работает ещё и как фильтр качества: в коллекции
 * feature_films много мусора и эксплуатационного кино. Если у тайтла есть
 * карточка в TMDB с постером и заметным числом голосов — это настоящий фильм.
 *
 * Запуск:  TMDB_API_KEY=... node scripts/build-archive-index.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';

const TMDB_KEY = process.env.TMDB_API_KEY;
if (!TMDB_KEY) {
	console.error('Нужен TMDB_API_KEY');
	process.exit(1);
}

const OUT = 'src/lib/data/archive-index.json';
const WANT = Number(process.env.WANT ?? 140); // сколько фильмов хотим на выходе
const SCAN = Number(process.env.SCAN ?? 600); // сколько кандидатов просмотреть
const MIN_VOTES = 40; // порог «это известный фильм, а не случайная плёнка»
const MIN_DURATION = 40 * 60; // короткометражки в каталог не берём

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
	for (let i = 1; i <= tries; i++) {
		try {
			const res = await fetch(url, { headers: { Accept: 'application/json' } });
			if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
			if (!res.ok) return null;
			return await res.json();
		} catch (e) {
			if (i === tries) return null;
			await sleep(400 * i);
		}
	}
	return null;
}

/* ------------------------- кандидаты из Internet Archive ------------------- */

async function fetchCandidates() {
	const collections = ['feature_films', 'film_noir', 'silent_films', 'sci-fi_horror'];
	const q = `(${collections.map((c) => `collection:(${c})`).join(' OR ')}) AND mediatype:(movies)`;

	const out = [];
	const perPage = 100;

	for (let page = 1; out.length < SCAN; page++) {
		const url =
			'https://archive.org/advancedsearch.php?q=' +
			encodeURIComponent(q) +
			'&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=downloads' +
			'&sort%5B%5D=downloads+desc' +
			`&rows=${perPage}&page=${page}&output=json`;

		const data = await getJson(url);
		const docs = data?.response?.docs ?? [];
		if (!docs.length) break;

		out.push(...docs);
		if (out.length >= (data.response.numFound ?? 0)) break;
		await sleep(200);
	}
	return out.slice(0, SCAN);
}

/* ------------------------------ сверка с TMDB ------------------------------ */

const cleanTitle = (t) =>
	String(t ?? '')
		// у архива в названиях часто мусор: имя рипа, студия, год в скобках
		.replace(/\([^)]*\)/g, ' ')
		.replace(/\b(dvd|vhs|rip|remastered|restored|hd|full movie|feature film)\b/gi, ' ')
		.replace(/[_\-–—]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

async function matchTmdb(title, year) {
	const q = cleanTitle(title);
	if (q.length < 2) return null;

	const url =
		`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}` +
		`&language=ru-RU&include_adult=false&query=${encodeURIComponent(q)}` +
		(year ? `&year=${year}` : '');

	const data = await getJson(url);
	const results = data?.results ?? [];

	for (const r of results.slice(0, 3)) {
		if (!r.poster_path) continue;
		if ((r.vote_count ?? 0) < MIN_VOTES) continue;

		// Год должен биться: одноимённые ремейки иначе перепутаются.
		if (year && r.release_date) {
			const ry = Number.parseInt(r.release_date.slice(0, 4), 10);
			if (Number.isFinite(ry) && Math.abs(ry - Number(year)) > 2) continue;
		}
		return r;
	}
	return null;
}

/* --------------------------- подбор файла в архиве ------------------------- */

async function pickFile(identifier) {
	const data = await getJson(`https://archive.org/metadata/${identifier}`);
	if (!data?.files) return null;

	const videos = data.files.filter((f) => /\.(mp4|m4v)$/i.test(f.name ?? ''));
	if (!videos.length) return null;

	const scored = videos
		.map((f) => ({
			name: f.name,
			size: Number(f.size ?? 0),
			length: Number.parseFloat(f.length ?? '0') || 0,
			// Вариант «512kb» у архива — заранее подготовленный для стриминга,
			// он легче и стартует быстрее оригинала.
			light: /512kb|_low|mpeg4/i.test(`${f.name} ${f.format ?? ''}`)
		}))
		.filter((f) => f.size > 5_000_000);

	if (!scored.length) return null;

	const duration = Math.max(...scored.map((f) => f.length));
	if (duration && duration < MIN_DURATION) return null;

	// Предпочитаем лёгкий вариант, иначе самый маленький из полноразмерных.
	const light = scored.filter((f) => f.light).sort((a, b) => b.size - a.size)[0];
	const chosen = light ?? scored.sort((a, b) => a.size - b.size)[0];

	return {
		file: chosen.name,
		sizeMb: Math.round(chosen.size / 1048576),
		durationSec: Math.round(chosen.length || duration || 0)
	};
}

/* ---------------------------------- пуск ----------------------------------- */

async function main() {
	console.log('Забираю кандидатов из Internet Archive…');
	const candidates = await fetchCandidates();
	console.log(`Кандидатов: ${candidates.length}`);

	const entries = [];
	const seenTmdb = new Set();
	let checked = 0;

	// По 4 параллельно: TMDB не любит всплесков, архив тоже.
	const CONC = 4;
	for (let i = 0; i < candidates.length && entries.length < WANT; i += CONC) {
		const batch = candidates.slice(i, i + CONC);

		const results = await Promise.all(
			batch.map(async (c) => {
				const tmdb = await matchTmdb(c.title, c.year);
				if (!tmdb || seenTmdb.has(tmdb.id)) return null;

				const file = await pickFile(c.identifier);
				if (!file) return null;

				return {
					tmdbId: tmdb.id,
					title: tmdb.title,
					year: tmdb.release_date ? Number(tmdb.release_date.slice(0, 4)) : null,
					identifier: c.identifier,
					file: file.file,
					durationSec: file.durationSec,
					sizeMb: file.sizeMb
				};
			})
		);

		for (const r of results) {
			if (!r || seenTmdb.has(r.tmdbId)) continue;
			seenTmdb.add(r.tmdbId);
			entries.push(r);
		}

		checked += batch.length;
		process.stdout.write(`\rПроверено ${checked}/${candidates.length}, отобрано ${entries.length}`);
		await sleep(150);
	}

	console.log('');
	entries.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

	await mkdir('src/lib/data', { recursive: true });
	await writeFile(
		OUT,
		JSON.stringify({ builtAt: new Date().toISOString(), films: entries }, null, '\t'),
		'utf8'
	);

	console.log(`\nГотово: ${entries.length} фильмов -> ${OUT}`);
	console.log('Примеры:');
	for (const e of entries.slice(0, 8)) console.log(`  ${e.year}  ${e.title}  (${e.sizeMb} МБ)`);
}

main().catch((e) => {
	console.error('\nОшибка:', e.message);
	process.exit(1);
});
