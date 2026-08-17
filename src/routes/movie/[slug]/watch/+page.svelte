<script lang="ts">
	import Player from '$lib/components/Player.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Смотреть {data.context.title} — КИНЕМА</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Player
	target={data.target}
	context={data.context}
	art={data.art}
	backHref={data.backHref}
/>
