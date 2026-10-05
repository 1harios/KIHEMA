<script lang="ts">
	import { goto } from '$app/navigation';
	import { rutubeIdFrom, rutubeWatchHref } from '$lib/rutube';
	import Icon from '$lib/components/ui/Icon.svelte';
	let url = $state('');
	let error = $state('');
	let hydrated = $state(false);
	$effect(() => { hydrated = true; });
	function open() {
		const id = rutubeIdFrom(url);
		if (!id) { error = 'Вставьте полную HTTPS-ссылку на видео RUTUBE'; return; }
		error = '';
		void goto(rutubeWatchHref(id));
	}
</script>
<svelte:head><title>RUTUBE вместе — КИХЕМА</title></svelte:head>
<section class="mx-auto max-w-2xl px-4 py-12 sm:py-20">
	<div class="rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-10">
		<p class="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent"><Icon name="users" size={20} /> RUTUBE вместе</p>
		<h1 class="font-display text-3xl font-bold sm:text-4xl">Одно видео.<br />Общий кинозал.</h1>
		<p class="mt-4 text-sm leading-relaxed text-white/60">Вставьте ссылку на ролик, создайте комнату и пригласите друзей. Общая пауза, перемотка и чат — на компьютере и телефоне.</p>
		<form class="mt-7" onsubmit={(event) => { event.preventDefault(); open(); }}>
			<label for="rutube-link" class="mb-2 block text-sm text-white/70">Ссылка на видео RUTUBE</label>
			<input id="rutube-link" bind:value={url} type="url" required placeholder="https://rutube.ru/video/…/" autocomplete="off" class="h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-[16px] outline-none focus:border-accent" />
			<button type="submit" disabled={!hydrated} class="mt-3 h-12 w-full rounded-full bg-accent font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50">Открыть видео</button>
			{#if error}<p role="alert" class="mt-3 text-sm text-warn">{error}</p>{/if}
		</form>
		<p class="mt-5 text-xs leading-relaxed text-white/40">Используется официальный плеер RUTUBE. Доступность ролика, реклама и ограничения определяются RUTUBE. Для совместного просмотра подходят обычные видео, не прямые трансляции.</p>
	</div>
</section>
