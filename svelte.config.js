import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';

/*
  Адаптер выбирается окружением.

  node   — самостоятельный хостинг рядом с Jellyfin. Живой процесс, индекс лежит
           на диске и обновляется по таймеру. Основной рабочий режим.
  vercel — публичная витрина интерфейса. Serverless: записываемого диска нет,
           фоновых таймеров нет, до Jellyfin в домашней сети не достучаться.
           На практике это демо-режим.

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
