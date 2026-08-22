<script lang="ts">
	/**
	 * Боковая панель комнаты: участники, реакции, «старт вместе» у хоста и чат.
	 * Пока панель открыта, счётчик непрочитанных не растёт.
	 */

	import {
		party,
		isHost,
		leave as leaveRoom,
		markChatRead,
		sendChat,
		sendReact,
		kick,
		startCountdown
	} from '$lib/party.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let draft = $state('');
	let feed: HTMLElement | null = $state(null);
	let copied = $state(false);

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
		const link = `${location.origin}${location.pathname}?room=${party.roomCode}`;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* без буфера обмена — покажем ссылку */
		}
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<div
	class="absolute bottom-24 right-0 top-0 z-30 flex w-80 max-w-[85vw] flex-col border-l
	       border-white/12 bg-canvas/97 backdrop-blur-xl"
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

	<!-- Участники -->
	<div class="max-h-40 overflow-y-auto border-b border-white/10 px-3 py-2">
		{#each party.peers as p (p.id)}
			<div class="flex items-center gap-2 py-1 text-[13px] text-white/85">
				{#if p.buffering}
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
		{#if isHost()}
			<button
				type="button"
				onclick={() => startCountdown()}
				class="ml-auto h-8 rounded-full border border-accent/60 px-3 text-[12px] font-semibold
				       text-accent transition hover:bg-accent hover:text-accent-ink"
				title="Отсчёт 3-2-1 и одновременный старт"
			>
				Старт вместе
			</button>
		{/if}
	</div>

	<!-- Чат -->
	<div bind:this={feed} class="flex-1 overflow-y-auto px-3 py-2">
		{#if !party.chatLog.length}
			<p class="pt-4 text-center text-[12px] text-white/30">Сообщений пока нет</p>
		{/if}
		{#each party.chatLog as m (m.id)}
			<div class="mb-2" class:text-right={m.self}>
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
