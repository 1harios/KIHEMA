import type { PageServerLoad } from './$types';
import { loadCatalog } from '$lib/server/catalog-loader';

export const load: PageServerLoad = async ({ url, setHeaders }) =>
	loadCatalog('show', url, setHeaders);
