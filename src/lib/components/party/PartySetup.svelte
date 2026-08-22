<script lang="ts">
	/**
	 * Поповер создания/входа в комнату совместного просмотра.
	 * Показывается из панели управления плеера, когда пользователь ещё не в комнате.
	 */

	import {
		party,
		savedName,
		create as createRoom,
		join as joinRoom
	} from '$lib/party.svelte';
	import type { RoomSnapshot } from '$lib/party.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		/** Снимок воспроизведения на момент создания комнаты. */
		snapshot: () => RoomSnapshot;
		onClose: () => void;
	}

	let { snapshot, onClose }: Props = $props();

	let name = $state(savedName());
	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function doCreate() {
		busy = true;
		error = null;
		try {
			await createRoom(name.trim() || 'Гость', snapshot());
			onClose();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Не удалось создать комнату';
		} finally {
			busy = false;
		}
	}

	async function doJoin() {
		const c = code.trim().toUpperCase();
		if (c.length < 4) {
			error = 'Введите код комнаты';
			return;
		}
		busy = true;
		error = null;
		try {
			await joinRoom(c, name.trim() || 'Гость', null);
			onClose();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Не удалось войти';
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="absolute bottom-full right-0 z-40 mb-3 w-72 rounded-md border border-white/12 bg-canvas/97
	       p-3 shadow-4 backdrop-blur-xl"
>
	<p class="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider
	          text-white/40">
		<Icon name="users" size={13} />
		Смотреть вместе
	</p>

	<label class="mb-1 block text-[11px] text-white/45" for="party-name">Ваше имя</label>
	<input
		id="party-name"
		bind:value={name}
		maxlength="24"
		placeholder="Гость"
		class="mb-3 h-9 w-full rounded-md border border-white/15 bg-black/30 px-3 text-[13px] text-white
		       outline-none transition placeholder:text-white/30 focus:border-accent"
	/>

	<button
		type="button"
		onclick={() => void doCreate()}
		disabled={busy || party.status === 'connecting'}
		class="mb-3 h-9 w-full rounded-full bg-accent text-[13px] font-semibold text-accent-ink
		       transition hover:bg-accent-hover disabled:opacity-50"
	>
		{#if busy && party.status === 'connecting'}Подключение…{:else}Создать комнату{/if}
	</button>

	<div class="mb-3 flex items-center gap-2 text-[11px] text-white/30">
		<span class="h-px flex-1 bg-white/10"></span>
		или войдите по коду
		<span class="h-px flex-1 bg-white/10"></span>
	</div>

	<form
		class="flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void doJoin();
		}}
	>
		<input
			bind:value={code}
			maxlength="6"
			placeholder="КОД"
			aria-label="Код комнаты"
			class="tnum h-9 w-24 rounded-md border border-white/15 bg-black/30 px-3 text-center text-[13px]
			       font-semibold uppercase tracking-widest text-white outline-none transition
			       placeholder:tracking-normal placeholder:text-white/30 focus:border-accent"
			oninput={() => (code = code.toUpperCase())}
		/>
		<button
			type="submit"
			disabled={busy || party.status === 'connecting'}
			class="h-9 flex-1 rounded-full border border-white/20 text-[13px] font-semibold text-white
			       transition hover:border-white/45 disabled:opacity-50"
		>
			Войти
		</button>
	</form>

	{#if error || party.error}
		<p class="mt-2 text-[11.5px] text-warn">{error ?? party.error}</p>
	{/if}
</div>
