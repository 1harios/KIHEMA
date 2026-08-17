import type { Handle } from '@sveltejs/kit';
import { config, isJellyfinConfigured, jellyfinAdmin, libraryIndex } from '$lib/server/config';
import { readSession } from '$lib/server/session';
import { THEMES, type Theme } from '$lib/types';

/**
 * Разовая инициализация: поднимаем индекс с диска и ставим периодическую пересборку.
 *
 * Модуль в SvelteKit исполняется один раз на процесс, так что таймер тоже один.
 * Первую сборку не ждём — она может идти минуты на большой библиотеке, а страницы
 * должны отдаваться сразу (просто без отметок «есть в медиатеке»).
 */
let bootstrapped = false;

/** Vercel, Netlify и подобные выставляют эти переменные сами. */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function bootstrap() {
	if (bootstrapped) return;
	bootstrapped = true;

	await libraryIndex.load();

	// Язык каталога — в лог. Пустая переменная окружения на хостинге даёт
	// английские названия при русском интерфейсе, и без этой строки причину
	// приходится искать через ответы API.
	console.log(
		`[boot] каталог: язык=${config.tmdb.language} регион=${config.tmdb.region}` +
			` креденшл=${config.tmdb.readToken ? 'read-token' : config.tmdb.apiKey ? 'api-key' : 'нет'}`
	);

	if (config.demoMode || !jellyfinAdmin) {
		if (config.demoMode) console.log('[boot] демо-режим: Jellyfin и TMDB не используются');
		return;
	}

	// Локальная копия после проверки выше: сужение типа импортированной
	// привязки не переносится внутрь замыкания refresh, потому что импорт для
	// TS — живая ссылка, а не константа.
	const admin = jellyfinAdmin;

	// На serverless процесс между запросами не живёт — таймер там бессмыслен,
	// свежесть проверяем на каждом запросе (ensureFresh ниже, в handle).
	if (isServerless) {
		libraryIndex.ensureFresh(admin, config.indexRefreshMinutes);
		return;
	}

	const refresh = () => {
		libraryIndex
			.rebuild(admin)
			.catch((e) => console.error('[index] пересборка не удалась:', e?.message ?? e));
	};

	// Индекс пуст или старше интервала — собираем сразу.
	const ageMinutes = (Date.now() - libraryIndex.builtAt.getTime()) / 60_000;
	if (libraryIndex.isEmpty || ageMinutes > config.indexRefreshMinutes) refresh();

	const timer = setInterval(refresh, config.indexRefreshMinutes * 60_000);
	// Таймер не должен держать процесс живым при остановке.
	if (typeof timer.unref === 'function') timer.unref();
}

export const handle: Handle = async ({ event, resolve }) => {
	await bootstrap();

	// Без живого процесса обновлять индекс больше негде. Вызов не блокирующий.
	if (isServerless && jellyfinAdmin && !config.demoMode) {
		libraryIndex.ensureFresh(jellyfinAdmin, config.indexRefreshMinutes);
	}

	const session = readSession(event.cookies);
	event.locals.user = session
		? { id: session.userId, name: session.userName, isAdmin: session.isAdmin }
		: null;

	const cookieTheme = event.cookies.get('theme');
	event.locals.theme = (THEMES as readonly string[]).includes(cookieTheme ?? '')
		? (cookieTheme as Theme)
		: 'default';
	event.locals.demoMode = config.demoMode;
	event.locals.libraryConnected = isJellyfinConfigured();

	return resolve(event, {
		// Тема влияет на класс <html>, поэтому кеш обязан её различать.
		filterSerializedResponseHeaders: (name) => name === 'content-type'
	});
};
