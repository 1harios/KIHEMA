<script lang="ts">
	/**
	 * Боковая панель комнаты: стоит рядом с видео и не перекрывает его.
	 * Участники, реакции, «старт вместе» (когда в комнате хотя бы двое),
	 * смена фильма хостом и чат. Пока панель открыта, счётчик непрочитанных не растёт.
	 */

	import { goto } from '$app/navigation';
	import {
		party,
		isHost,
		leave as leaveRoom,
		markChatRead,
		sendChat,
		sendGoto,
		sendReact,
		kick,
		startCountdown,
		withPartyParams,
		invitationUrl,
		sendState,
		sharedPosition
	} from '$lib/party.svelte';
	import { toMediaSlug } from '$lib/slug';
	import type { CatalogItem } from '$lib/types';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let draft = $state('');
	let feed: HTMLElement | null = $state(null);
	let copied = $state(false);
	let inviteError = $state('');

	const REACTIONS = ['❤️', '😂', '👍', '😮'];

	$effect(() => {
		party.chatOpen = true;
		markChatRead();
		return () => {
			party.chatOpen = false;
		};
	});

	// Новые сообщения прижимают ленту к низу.
	$effect(() => {
		party.chatLog.length;
		if (feed) feed.scrollTop = feed.scrollHeight;
	});

	function submit() {
		const text = draft.trim();
		if (!text) return;
		sendChat(text);
		draft = '';
	}

	async function copyInvite() {
		const link = invitationUrl();
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			inviteError = 'Выделите и скопируйте ссылку ниже';
		}
	}

	async function shareInvite() {
		if (!navigator.share) { await copyInvite(); return; }
		try { await navigator.share({ title: 'Смотрим вместе в КИХЕМА', url: invitationUrl() }); }
		catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) await copyInvite(); }
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
	}

	/* ------------------------- смена фильма (хост) ------------------------- */

	let pickerOpen = $state(false);
	let query = $state('');
	let results = $state<CatalogItem[]>([]);
	let searching = $state(false);

	// Живой поиск с дебаунсом; устаревшие запросы отменяем.
	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		const ctrl = new AbortController();
		const t = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&compact=1`, {
					signal: ctrl.signal
				});
				if (res.ok) {
					results = (await res.json()).titles as CatalogItem[];
					searching = false;
				}
			} catch {
				if (!ctrl.signal.aborted) searching = false;
			}
		}, 300);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	});

	function watchHref(item: CatalogItem): string {
		return `/${item.type}/${toMediaSlug(item)}/watch`;
	}

	function pick(item: CatalogItem) {
		const href = watchHref(item);
		sendGoto(href);
		pickerOpen = false;
		query = '';
		onClose();
		void goto(withPartyParams(href));
	}
</script>

<div
	class="party-panel-in fixed inset-y-0 right-0 z-50 flex h-full w-80 max-w-[92vw] shrink-0 flex-col border-l border-white/12 sm:relative sm:inset-auto sm:z-auto sm:max-w-[50vw]
	       bg-canvas/97 backdrop-blur-xl"
>
	<!-- Заголовок: код комнаты, приглашение, выход -->
	<div class="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
		<Icon name="users" size={16} class="text-accent" />
		<button
			type="button"
			onclick={() => void copyInvite()}
			class="tnum rounded-md bg-white/8 px-2 py-1 text-[13px] font-semibold tracking-widest
			       text-white transition hover:bg-white/15"
			title="Скопировать ссылку-приглашение"
		>
			{party.roomCode}
		</button>
		{#if copied}<span class="text-[11px] text-accent">скопировано</span>{/if}
		<div class="ml-auto flex items-center gap-1">
			<button
				type="button"
				onclick={() => {
					leaveRoom();
					onClose();
				}}
				class="grid h-8 w-8 place-items-center rounded-full text-white/60 transition
				       hover:bg-white/10 hover:text-white"
				aria-label="Покинуть комнату"
				title="Покинуть комнату"
			>
				<Icon name="logout" size={16} />
			</button>
			<button
				type="button"
				onclick={onClose}
				class="grid h-8 w-8 place-items-center rounded-full text-white/60 transition
				       hover:bg-white/10 hover:text-white"
				aria-label="Закрыть панель"
			>
				<Icon name="close" size={16} />
			</button>
		</div>
	</div>

	<div class="border-b border-white/10 p-3">
		<p class="mb-2 text-[12px] text-white/60">Пригласите друзей по ссылке — код вводить не нужно.</p>
		<input aria-label="Ссылка-приглашение" readonly value={invitationUrl()}
			onclick={(event) => event.currentTarget.select()}
			class="h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2.5 text-[11px] text-white/70" />
		<div class="mt-2 flex gap-2">
			<button type="button" onclick={() => void copyInvite()} class="h-10 flex-1 rounded-full bg-accent text-xs font-semibold text-accent-ink">{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
			<button type="button" onclick={() => void shareInvite()} class="h-10 rounded-full border border-white/20 px-3 text-xs text-white">Поделиться</button>
		</div>
		{#if inviteError}<p class="mt-2 text-[11px] text-white/50">{inviteError}</p>{/if}
	</div>

	<!-- Участники -->
	<div class="max-h-40 overflow-y-auto border-b border-white/10 px-3 py-2">
		{#each party.peers as p (p.id)}
			<div class="flex items-center gap-2 py-1 text-[13px] text-white/85">
				{#if p.buffering || !p.ready}
					<span
						class="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-white/25
						       border-t-accent"
						title="Буферизация"
					></span>
				{:else}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"></span>
				{/if}
				<span class="truncate">
					{p.name}
					{#if p.id === party.selfId}<span class="text-white/40">(вы)</span>{/if}
				</span>
				<span class="ml-auto text-[10px] text-white/40">{p.ready ? 'Готов' : 'Загружается'}</span>
				{#if p.id === party.hostId}
					<Icon name="crown" size={13} class="shrink-0 text-amber-300" />
				{/if}
				{#if isHost() && p.id !== party.selfId}
					<button
						type="button"
						onclick={() => kick(p.id)}
						class="ml-auto text-[11px] text-white/35 transition hover:text-warn"
						title="Исключить из комнаты"
					>
						кик
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Реакции + старт вместе -->
	<div class="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
		{#each REACTIONS as emoji (emoji)}
			<button
				type="button"
				onclick={() => sendReact(emoji)}
				class="grid h-8 w-8 place-items-center rounded-full text-base transition hover:bg-white/12"
				aria-label="Реакция {emoji}"
			>
				{emoji}
			</button>
		{/each}
		<!-- Кнопка имеет смысл, только когда в комнате хотя бы двое. -->
		{#if isHost() && party.peers.length >= 2}
			<button
				type="button"
				onclick={() => startCountdown()}
				disabled={party.roomState?.waitingForReady}
				class="ml-auto h-8 rounded-full border border-accent/60 px-3 text-[12px] font-semibold
				       text-accent transition hover:bg-accent hover:text-accent-ink"
				title="Отсчёт 3-2-1 и одновременный старт"
			>
				{party.roomState?.waitingForReady ? 'Ждём зрителей' : 'Старт вместе'}
			</button>
		{/if}
	</div>
	{#if party.roomState?.waitingForReady}
		<div class="border-b border-white/10 px-3 py-2 text-xs text-white/60" role="status">
			Готовы {party.peers.filter((p) => p.ready).length} из {party.peers.length}. Начнём вместе после загрузки.
			{#if isHost()}<button type="button" onclick={() => sendState(true, sharedPosition())} class="mt-1 block text-accent">Отменить ожидание</button>{/if}
		</div>
	{/if}

	<!-- Смена фильма (только хост) -->
	{#if isHost()}
		<div class="border-b border-white/10 px-3 py-2">
			<button
				type="button"
				onclick={() => (pickerOpen = !pickerOpen)}
				class="flex w-full items-center gap-2 text-[12px] font-semibold text-white/70
				       transition hover:text-white"
				aria-expanded={pickerOpen}
			>
				<Icon name="film" size={14} />
				Сменить фильм
				<Icon name="chevronDown" size={13} class="ml-auto transition {pickerOpen ? 'rotate-180' : ''}" />
			</button>
			{#if pickerOpen}
				<input
					bind:value={query}
					placeholder="Название фильма или сериала…"
					aria-label="Поиск фильма для комнаты"
					class="mt-2 h-9 w-full rounded-full border border-white/15 bg-black/30 px-3.5
					       text-[13px] text-white outline-none transition placeholder:text-white/30
					       focus:border-accent"
				/>
				<div class="mt-1.5 max-h-52 space-y-0.5 overflow-y-auto">
					{#if searching && !results.length}
						<p class="py-2 text-center text-[12px] text-white/30">Ищем…</p>
					{:else if query.trim().length >= 2 && !results.length}
						<p class="py-2 text-center text-[12px] text-white/30">Ничего не нашлось</p>
					{/if}
					{#each results as item (item.type + item.tmdbId)}
						<button
							type="button"
							onclick={() => pick(item)}
							class="party-msg-in flex w-full items-center gap-2 rounded-md px-2 py-1.5
							       text-left transition hover:bg-white/10"
							title="Переключить комнату на этот тайтл"
						>
							<span class="flex-1 truncate text-[13px] text-white/85">{item.title}</span>
							{#if item.year}<span class="tnum text-[11px] text-white/40">{item.year}</span>{/if}
							<span class="rounded bg-white/10 px-1 text-[10px] text-white/50">
								{item.type === 'movie' ? 'фильм' : 'сериал'}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Чат -->
	<div bind:this={feed} class="flex-1 overflow-y-auto px-3 py-2">
		{#if !party.chatLog.length}
			<p class="pt-4 text-center text-[12px] text-white/30">Сообщений пока нет</p>
		{/if}
		{#each party.chatLog as m (m.id)}
			<div class="party-msg-in mb-2" class:text-right={m.self}>
				<p class="text-[11px] text-white/40">
					{#if !m.self}<span class="font-semibold text-white/60">{m.name}</span> · {/if}
					{formatTime(m.ts)}
				</p>
				<p
					class="mt-0.5 inline-block max-w-full break-words rounded-lg px-2.5 py-1.5 text-[13px]
					       leading-snug {m.self ? 'bg-accent/20 text-white' : 'bg-white/8 text-white/90'}"
				>
					{m.text}
				</p>
			</div>
		{/each}
	</div>

	<!-- Ввод -->
	<form
		class="flex gap-2 border-t border-white/10 p-2.5"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<input
			bind:value={draft}
			maxlength="300"
			placeholder="Сообщение…"
			aria-label="Сообщение в чат"
			class="h-9 min-w-0 flex-1 rounded-full border border-white/15 bg-black/30 px-3.5 text-[13px]
			       text-white outline-none transition placeholder:text-white/30 focus:border-accent"
		/>
		<button
			type="submit"
			class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-ink
			       transition hover:bg-accent-hover disabled:opacity-40"
			disabled={!draft.trim()}
			aria-label="Отправить"
		>
			<Icon name="send" size={15} />
		</button>
	</form>
</div>

<style>
	/* Панель выезжает справа, сообщения мягко появляются. */
	@keyframes party-panel-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.party-panel-in {
		animation: party-panel-in 0.22s var(--ease-out-quint, ease-out) both;
	}

	@keyframes party-msg-in {
		from {
			transform: translateY(6px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.party-msg-in {
		animation: party-msg-in 0.2s ease-out both;
	}

	@media (prefers-reduced-motion: reduce) {
		.party-panel-in,
		.party-msg-in {
			animation: none;
		}
	}
</style>
