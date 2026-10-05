<script lang="ts">
	/**
	 * Боковая панель комнаты: стоит рядом с видео и не перекрывает его.
	 * Участники, реакции, «старт вместе» (когда в комнате хотя бы двое),
	 * смена фильма хостом и чат. Пока панель открыта, счётчик непрочитанных не растёт.
	 */

	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
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
	import { rutubeIdFrom, rutubeWatchHref } from '$lib/rutube';
	import type { CatalogItem } from '$lib/types';
	import Icon from '../ui/Icon.svelte';
	import PartyMediaPicker from './PartyMediaPicker.svelte';

	interface Props {
		onClose: () => void;
		compact?: boolean;
	}

	let { onClose, compact = false }: Props = $props();

	let draft = $state('');
	let feed: HTMLElement | null = $state(null);
	let copied = $state(false);
	let inviteError = $state('');
	let infoOpen = $state(false);
	let mediaOpen = $state(false);
	let expanded = $state(false);

	const REACTIONS = ['❤️', '😂', '👍'];

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
		if (feed) void tick().then(() => { if (feed) feed.scrollTop = feed.scrollHeight; });
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
	let rutubeOpen = $state(false);
	let rutubeLink = $state('');
	let rutubeError = $state('');
	function pickRutube() {
		const id = rutubeIdFrom(rutubeLink);
		if (!id) { rutubeError = 'Нужна HTTPS-ссылка на видео RUTUBE'; return; }
		const href = rutubeWatchHref(id);
		sendGoto(href, 'Видео RUTUBE');
		rutubeOpen = false; rutubeError = ''; rutubeLink = '';
		onClose();
		void goto(withPartyParams(href));
	}

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
		sendGoto(href, item.title);
		pickerOpen = false;
		query = '';
		onClose();
		void goto(withPartyParams(href));
	}
</script>

<section class="party-panel party-panel-in flex min-h-0 shrink-0 flex-col border-l border-white/12 bg-canvas/97 text-white backdrop-blur-xl" class:expanded class:media-open={mediaOpen}
	aria-label="Чат совместного просмотра">
	<!-- Invitations and participants are behind one disclosure, not above the chat. -->
	<div class="flex shrink-0 items-center gap-1 border-b border-white/10 px-2">
		<button type="button" onclick={() => (infoOpen = !infoOpen)} aria-expanded={infoOpen}
			aria-label="Настройки комнаты" class="flex h-12 min-w-0 flex-1 items-center gap-2 px-2 text-sm font-semibold">
			<Icon name="users" size={17} class="text-accent" />
			Чат <span class="text-xs font-normal text-white/45">· {party.peers.length}</span>
			<Icon name="chevronDown" size={13} class="transition {infoOpen ? 'rotate-180' : ''}" />
		</button>
		<button type="button" onclick={() => void shareInvite()} aria-label="Пригласить друзей"
			class="h-11 rounded-full px-3 text-xs text-accent">{copied ? 'Скопировано' : 'Пригласить'}</button>
		<button type="button" class="expand-chat grid h-11 w-9 shrink-0 place-items-center text-white/60" aria-label={expanded ? 'Уменьшить чат' : 'Увеличить чат'} aria-expanded={expanded} onclick={() => (expanded = !expanded)}><Icon name={expanded ? 'chevronDown' : 'chevronUp'} size={17} /></button>
		<button type="button" onclick={onClose} aria-label="Закрыть панель"
			class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10">
			<Icon name="close" size={18} />
		</button>
	</div>
	{#if infoOpen || inviteError}
	<div class="room-details min-h-0 shrink-0 overflow-y-auto border-b border-white/10 px-3 py-3">
		<div class="mb-2 flex items-center justify-between gap-2">
			<span class="text-xs text-white/55">Комната <span class="tnum font-semibold tracking-widest text-white">{party.roomCode}</span></span>
			<button type="button" onclick={() => { leaveRoom(); onClose(); }} aria-label="Покинуть комнату"
				class="flex h-9 items-center gap-1.5 text-xs text-white/50 hover:text-white"><Icon name="logout" size={14} />Выйти</button>
		</div>
		<input aria-label="Ссылка-приглашение" readonly value={invitationUrl()}
			onclick={(event) => event.currentTarget.select()}
			class="h-10 w-full rounded-lg border border-white/15 bg-black/30 px-2.5 text-[16px] text-white/70" />
		<div class="my-2 flex gap-2">
			<button type="button" onclick={() => void copyInvite()} class="h-10 flex-1 rounded-full bg-white/10 text-xs font-semibold">{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
			<button type="button" onclick={() => void shareInvite()} class="h-10 rounded-full border border-white/20 px-3 text-xs">Поделиться</button>
		</div>
		{#if inviteError}<p class="mb-2 text-xs text-white/50">{inviteError}</p>{/if}
		<p class="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-widest text-white/35">Участники</p>
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
	<!-- Смена фильма (только хост) -->
	{#if isHost()}
		<div class="mt-3 border-t border-white/10 pt-2">
			<button type="button" onclick={() => (rutubeOpen = !rutubeOpen)} aria-expanded={rutubeOpen}
				class="flex h-10 w-full items-center gap-2 text-xs font-semibold text-white/70"><Icon name="play" size={14} /> Видео RUTUBE</button>
			{#if rutubeOpen}
				<form class="mb-2 space-y-2" onsubmit={(event) => { event.preventDefault(); pickRutube(); }}>
					<input bind:value={rutubeLink} type="url" required placeholder="https://rutube.ru/video/…/" aria-label="Ссылка RUTUBE для комнаты" class="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-[16px] outline-none focus:border-accent" />
					<button type="submit" class="h-10 w-full rounded-full bg-accent text-xs font-semibold text-accent-ink">Включить всем</button>
					{#if rutubeError}<p role="alert" class="text-xs text-warn">{rutubeError}</p>{/if}
				</form>
			{/if}
			<button type="button" onclick={() => (pickerOpen = !pickerOpen)}
				class="flex h-10 w-full items-center gap-2 text-xs font-semibold text-white/70" aria-expanded={pickerOpen}>
				<Icon name="film" size={14} /> Сменить фильм
				<Icon name="chevronDown" size={13} class="ml-auto transition {pickerOpen ? 'rotate-180' : ''}" />
			</button>
			{#if pickerOpen}
				<input bind:value={query} placeholder="Фильм или сериал…" aria-label="Поиск фильма для комнаты"
					class="h-11 w-full rounded-full border border-white/15 bg-black/30 px-3.5 text-[16px] outline-none focus:border-accent" />
				<div class="mt-2 space-y-1">
					{#if searching && !results.length}<p class="py-2 text-xs text-white/40">Ищем…</p>
					{:else if query.trim().length >= 2 && !results.length}<p class="py-2 text-xs text-white/40">Ничего не нашлось</p>{/if}
					{#each results as item (item.type + item.tmdbId)}
						<button type="button" onclick={() => pick(item)}
							class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-white/10">
							<span class="min-w-0 flex-1 text-sm">{item.title}</span>
							{#if item.year}<span class="tnum text-xs text-white/40">{item.year}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	</div>
	{/if}

	<div class="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1">
		{#each REACTIONS as emoji (emoji)}
			<button
				type="button"
				onclick={() => sendReact(emoji)}
				class="grid h-10 w-10 place-items-center rounded-full text-base transition hover:bg-white/12"
				aria-label="Реакция {emoji}"
			>
				{emoji}
			</button>
		{/each}
		<!-- Кнопка имеет смысл, только когда в комнате хотя бы двое. -->
		<button type="button" aria-label="Ещё реакции" aria-expanded={mediaOpen} onclick={() => { mediaOpen = !mediaOpen; infoOpen = false; }} class="grid h-10 w-10 place-items-center rounded-full text-white/60 hover:bg-white/12"><Icon name="smile" size={20} /></button>
		{#if !compact && isHost() && party.peers.length >= 2}
			<button
				type="button"
				onclick={() => startCountdown()}
				disabled={party.roomState?.waitingForReady}
				class="ml-auto h-10 rounded-full border border-accent/60 px-3 text-[12px] font-semibold
				       text-accent transition hover:bg-accent hover:text-accent-ink"
				title="Отсчёт 3-2-1 и одновременный старт"
			>
				{party.roomState?.waitingForReady ? 'Ждём зрителей' : 'Старт вместе'}
			</button>
		{/if}
	</div>
	{#if party.roomState?.waitingForReady}
		<div class="shrink-0 border-b border-white/10 px-3 py-2 text-xs text-white/60" role="status">
			Готовы {party.peers.filter((p) => p.ready).length} из {party.peers.length}. Ждём загрузку у всех.
			{#if isHost()}<button type="button" onclick={() => sendState(true, sharedPosition())} class="mt-1 block text-accent">Отменить ожидание</button>{/if}
		</div>
	{/if}

	<!-- Чат -->
	{#if mediaOpen}<PartyMediaPicker onClose={() => (mediaOpen = false)} />{:else}
	<div bind:this={feed} role="log" aria-label="Сообщения комнаты" aria-live="polite"
		class="min-h-0 flex-1 select-text overflow-y-auto overscroll-contain px-3 py-3">
		{#if !party.chatLog.length}
			<p class="pt-4 text-center text-[12px] text-white/30">Сообщений пока нет</p>
		{/if}
		{#each party.chatLog as m (m.id)}
			<div class="party-msg-in mb-2" class:text-right={m.self}>
				<p class="text-[11px] text-white/40">
					{#if !m.self}<span class="font-semibold text-white/60">{m.name}</span> · {/if}
					{formatTime(m.ts)}
				</p>
				{#if m.gif}
					<figure class="chat-gif mt-1 inline-block rounded-xl bg-white/8 p-1.5 text-left"><img src={m.gif.url} alt={m.gif.title} loading="lazy" referrerpolicy="no-referrer" /><figcaption><a href={m.gif.source} target="_blank" rel="noopener noreferrer">{m.gif.title} ↗</a><span>{m.gif.author} · {m.gif.license}</span></figcaption></figure>
				{:else}<p
					class="mt-0.5 inline-block max-w-full break-words rounded-lg px-2.5 py-1.5 text-[13px]
					       leading-snug {m.self ? 'bg-accent/20 text-white' : 'bg-white/8 text-white/90'}"
				>
					{m.text}
				</p>{/if}
			</div>
		{/each}
	</div>
	{/if}

	<!-- Ввод -->
	<form
		class="chat-composer flex shrink-0 gap-2 border-t border-white/10 p-2.5"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<button type="button" class="grid h-11 w-10 shrink-0 place-items-center rounded-full text-white/65 hover:bg-white/10" aria-label="Открыть стикеры и GIF" aria-expanded={mediaOpen} onclick={() => { mediaOpen = !mediaOpen; infoOpen = false; }}><Icon name="smile" size={21} /></button>
		<input
			bind:value={draft}
			maxlength="300"
			placeholder="Сообщение…"
			aria-label="Сообщение в чат"
			enterkeyhint="send"
			autocomplete="off"
			class="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-black/30 px-3.5 text-[16px]
			       text-white outline-none transition placeholder:text-white/30 focus:border-accent"
		/>
		<button
			type="submit"
			class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink
			       transition hover:bg-accent-hover disabled:opacity-40"
			disabled={!draft.trim()}
			aria-label="Отправить"
		>
			<Icon name="send" size={15} />
		</button>
	</form>
</section>

<style>
	.party-panel { width: 340px; max-width: 46%; height: 100%; }
	.expand-chat { display: none; }
	.chat-gif { max-width: 230px; width: 100%; }
	.chat-gif img { width: 100%; max-height: 170px; object-fit: contain; border-radius: 8px; }
	.chat-gif figcaption { padding: 4px 2px 1px; font-size: 10px; line-height: 1.3; overflow-wrap: anywhere; color: #a4acba; }
	.chat-gif figcaption span { display: block; font-size: 9px; }
	.room-details { max-height: 45%; }
	.chat-composer { padding-bottom: max(0.625rem, env(safe-area-inset-bottom)); }
	@media (max-width: 639px) and (orientation: portrait) {
		.party-panel { width: 100%; max-width: none; height: clamp(210px, 32dvh, 280px); flex: 0 0 auto; border-left: 0; border-top: 1px solid rgb(255 255 255 / 0.12); }
		.party-panel.expanded { height: min(52dvh, 440px); }
		.party-panel.media-open { height: min(60dvh, 460px); }
		.expand-chat { display: grid; }
		:global(.keyboard-open) .party-panel { flex: 1 1 0; height: auto; }
		:global(.keyboard-open) .party-panel .chat-gif img { max-height: 100px; }
	}
	@media (orientation: landscape) and (max-height: 500px) {
		.party-panel { width: 280px; max-width: 38%; padding-right: env(safe-area-inset-right); }
	}
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
