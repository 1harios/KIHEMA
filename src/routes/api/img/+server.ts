import type { RequestHandler } from '@sveltejs/kit';

/**
 * Прокси для картинок TMDB.
 *
 * image.tmdb.org блокируется рядом провайдеров (особенно в РФ) — без VPN
 * постеры и фоны не грузятся. Этот эндпоинт разруливает проблему: сервер
 * Vercel (US) ходит в TMDB сам и отдаёт картинку клиенту с CORS-заголовками.
 *
 * Использование:  /api/img?src=/w342/abc.jpg
 */

/*
	Белый список размеров.

	h632 здесь появился не для полноты: без него не грузились ВСЕ фотографии на
	странице персоны. Именно этот размер запрашивает profileUrl (у TMDB портреты
	отдаются с фиксированной высотой, а не шириной), прокси отвечал «Invalid
	size», и страница выглядела пустой. Список обязан совпадать с тем, что
	просит код, — расхождение здесь даёт молчаливую поломку целой страницы.
*/
const ALLOWED_SIZES = new Set([
	'w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'w1280',
	// портреты персон
	'h632',
	// полный размер для просмотрщика галереи
	'original'
]);

const CACHE_TTL = 60 * 60 * 24 * 30; // 30 дней — TMDB-картинки почти не меняются

const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-headers': '*',
	'access-control-allow-methods': 'GET,HEAD,OPTIONS'
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });

export const GET: RequestHandler = async ({ url }) => {
	const src = url.searchParams.get('src');
	if (!src) return new Response('Missing src', { status: 400 });

	const upstream = `https://image.tmdb.org/t/p${src}`;

	// Валидация: первый сегмент пути — размер
	const segments = upstream.replace('https://image.tmdb.org/t/p/', '').split('/');
	const size = segments[0];
	if (!ALLOWED_SIZES.has(size)) return new Response('Invalid size', { status: 400 });

	try {
		const res = await fetch(upstream, {
			headers: { accept: 'image/*' }
		});

		if (!res.ok) return new Response('Upstream error', { status: res.status });

		const contentType = res.headers.get('content-type') ?? 'image/jpeg';

		return new Response(res.body, {
			status: 200,
			headers: {
				'content-type': contentType,
				'cache-control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}, immutable`,
				...CORS
			}
		});
	} catch (e) {
		console.error('[img-proxy] fetch failed:', e instanceof Error ? e.message : e);
		return new Response('Proxy error', { status: 502 });
	}
};
