import type { PageServerLoad } from './$types';
import { loadTitle } from '$lib/server/title-loader';

export const load: PageServerLoad = async ({ params, setHeaders }) =>
	loadTitle('movie', params.slug, null, setHeaders);
