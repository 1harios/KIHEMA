import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';

/*
  Адаптер выбирается окружением.

  node   — самостоятельный хостинг на VPS. Живой процесс; при подключённом
           Jellyfin индекс лежит на диске и обновляется по таймеру.
  vercel — serverless-хостинг. Каталог TMDB и VPS-воспроизведение работают,
           но фоновые таймеры и записываемый постоянный диск недоступны.

  Vercel сам выставляет VERCEL=1 при сборке, вручную задавать ничего не нужно.
*/
const useVercel = process.env.VERCEL === '1' || process.env.ADAPTER === 'vercel';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: useVercel ? adapterVercel({ runtime: 'nodejs22.x' }) : adapterNode(),
		alias: { $lib: 'src/lib' }
	}
};
