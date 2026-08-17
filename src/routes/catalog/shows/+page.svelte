<script lang="ts">
	import CatalogPage from '$lib/components/CatalogPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<CatalogPage {data} />
