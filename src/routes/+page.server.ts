import type { PageServerLoad } from './$types';
import { getHome, NETWORKS } from '$lib/server/catalog';

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	const networkId = Number.parseInt(url.searchParams.get('network') ?? '', 10);
	const home = await getHome(Number.isFinite(networkId) ? networkId : undefined);

	// Каталог меняется медленно — пусть CDN подержит минуту.
	setHeaders({ 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' });

	return { ...home, networks: NETWORKS, activeNetwork: Number.isFinite(networkId) ? networkId : null };
};
