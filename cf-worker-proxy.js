/**
 * Прокси для API lightstream.ws — обходит бан датацентровых IP.
 *
 * Разверните на Cloudflare Workers (бесплатно):
 *   1. Зарегистрируйтесь на dash.cloudflare.com
 *   2. Workers & Pages → Create Worker → назовите ls-proxy → Deploy
 *   3. Edit code → вставьте этот файл → Deploy
 *   4. Получите URL вида https://ls-proxy.<ваш-субдомен>.workers.dev
 *   5. На сайте задайте переменную окружения SCRAPERS_API_URL:
 *      https://ls-proxy.<субдомен>.workers.dev/api/scrape
 */

const ALLOWED_ORIGIN = 'https://lightstream-psi.vercel.app';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Проксируем только пути их API.
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    // Пускаем только наш сайт.
    if (request.headers.get('origin') !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    const upstream = new URL('https://lightstream.ws' + url.pathname + url.search);
    const res = await fetch(upstream, {
      headers: {
        accept: 'application/json',
        origin: 'https://lightstream.ws',
        referer: 'https://lightstream.ws/',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    });

    // Заголовки ответа прокрашиваем, тело отдаём как есть.
    const headers = new Headers();
    headers.set('content-type', res.headers.get('content-type') ?? 'application/json');
    headers.set('access-control-allow-origin', ALLOWED_ORIGIN);
    headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  }
};
