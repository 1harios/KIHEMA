import type { PageServerLoad } from './$types';
import { loadTitle } from '$lib/server/title-loader';

export const load: PageServerLoad = async ({ params, url, setHeaders }) =>
	loadTitle('show', params.slug, url.searchParams.get('season'), setHeaders);
