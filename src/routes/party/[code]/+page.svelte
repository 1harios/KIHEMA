<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { party, join, leave, inParty, savedName, withPartyParams } from '$lib/party.svelte';
	import { roomCodeFrom, watchHref } from '$lib/party-sync';
	import Icon from '$lib/components/ui/Icon.svelte';

	const code = $derived(roomCodeFrom(page.params.code ?? ''));
	let name = $state('');
	let busy = $state(false);
	let hydrated = $state(false);
	let error = $state('');
	$effect(() => { name = savedName(); hydrated = true; });

	async function enter() {
		if (!code || busy) return;
		busy = true;
		error = '';
		try {
			if (inParty() && party.roomCode !== code) leave();
			if (!inParty()) await join(code, name.trim() || 'Гость', null);
			const href = watchHref(party.roomState?.targetHref ?? '');
			if (!href) { leave(); throw new Error('В комнате пока не выбран фильм'); }
			await goto(withPartyParams(href));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Не удалось войти в комнату';
		} finally { busy = false; }
	}
</script>

<svelte:head>
	<title>Приглашение на совместный просмотр — КИХЕМА</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section class="mx-auto flex min-h-[70svh] max-w-lg items-center px-4 py-10">
	<div class="w-full rounded-3xl border border-white/10 bg-white/[0.025] p-6 sm:p-9">
		<div class="mb-6 flex items-center gap-3 text-accent"><Icon name="users" size={28} /><span class="text-xs font-semibold uppercase tracking-widest">Смотрим вместе</span></div>
		<h1 class="font-display text-2xl font-bold text-white sm:text-3xl">Вас пригласили в кинозал</h1>
		<p class="mt-3 text-sm leading-relaxed text-white/55">Один фильм, общий старт, синхронная пауза и перемотка. После входа откроется текущий фильм комнаты.</p>
		{#if code}
			<p class="mt-5 text-sm text-white/45">Комната <span class="ml-2 font-semibold tracking-widest text-white">{code}</span></p>
			<form class="mt-6" onsubmit={(event) => { event.preventDefault(); void enter(); }}>
				<label for="guest-name" class="mb-2 block text-sm text-white/70">Как вас зовут?</label>
				<input id="guest-name" bind:value={name} maxlength="24" autocomplete="nickname" placeholder="Гость"
					class="h-12 w-full rounded-xl border border-white/15 bg-black/25 px-4 text-white outline-none focus:border-accent" />
				<button type="submit" disabled={busy || !hydrated} class="mt-4 h-12 w-full rounded-full bg-accent font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50">
					{busy ? 'Подключаемся к комнате…' : 'Присоединиться к просмотру'}
				</button>
			</form>
		{:else}<p class="mt-5 text-sm text-warn">Ссылка-приглашение некорректна. Попросите ведущего отправить новую.</p>{/if}
		{#if error}<p class="mt-4 text-sm text-warn" role="alert">{error}</p>{/if}
		<a href="/" class="mt-6 inline-block text-sm text-white/45 hover:text-white">На главную</a>
	</div>
</section>
