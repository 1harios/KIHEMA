<script lang="ts">
	import TitlePage from '$lib/components/TitlePage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<TitlePage title={data.title} season={data.season} episodes={data.episodes} />
