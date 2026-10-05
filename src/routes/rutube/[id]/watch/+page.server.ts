import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { RUTUBE_ID } from '$lib/rutube';
import { rutubeMetadata } from '$lib/server/rutube';

export const load: PageServerLoad = async ({ params }) => {
	if (!RUTUBE_ID.test(params.id)) error(404, 'Некорректная ссылка RUTUBE');
	return { video: await rutubeMetadata(params.id) };
};
