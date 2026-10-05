<script lang="ts">
	import RutubePlayer from '$lib/components/RutubePlayer.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>{data.video.title} — смотрим вместе в КИХЕМА</title></svelte:head>
{#key data.video.id}<RutubePlayer video={data.video} />{/key}
