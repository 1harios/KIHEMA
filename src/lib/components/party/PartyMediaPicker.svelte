<script lang="ts">
	import { PARTY_REACTIONS, PARTY_STICKERS, partyGif, type PartyGif } from '$lib/party-media';
	import { sendGif, sendReact, sendSticker } from '$lib/party.svelte';
	import Icon from '../ui/Icon.svelte';
	let { onClose }: { onClose: () => void } = $props();
	let tab = $state('reactions');
	let query = $state('Коты');
	let retry = $state(0);
	let loading = $state(false);
	let error = $state('');
	let gifs = $state<PartyGif[]>([]);
	$effect(() => {
		const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
		window.addEventListener('keydown', escape, true);
		return () => window.removeEventListener('keydown', escape, true);
	});
	$effect(() => {
		if (tab !== 'gifs') return;
		const q = query.trim() || 'Коты';
		retry;
		loading = true; error = ''; gifs = [];
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/party/gifs?q=${encodeURIComponent(q)}`, { signal: controller.signal });
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Поиск временно недоступен');
				if (!controller.signal.aborted) gifs = (Array.isArray(data.results) ? data.results : []).map(partyGif).filter((gif: PartyGif | null): gif is PartyGif => !!gif);
			} catch (e) { if (!controller.signal.aborted) error = e instanceof Error ? e.message : 'Не удалось найти GIF'; }
			finally { if (!controller.signal.aborted) loading = false; }
		}, 350);
		return () => { clearTimeout(timer); controller.abort(); };
	});
</script>

<section class="media-picker" aria-label="Реакции, стикеры и GIF">
	<div class="media-tabs" role="group" aria-label="Тип сообщения">
		{#each [{ id: 'reactions', label: 'Реакции' }, { id: 'stickers', label: 'Стикеры' }, { id: 'gifs', label: 'GIF' }] as item}
			<button type="button" aria-pressed={tab === item.id} onclick={() => (tab = item.id)}>{item.label}</button>
		{/each}
		<button type="button" class="close-picker" aria-label="Закрыть выбор реакций" onclick={onClose}><Icon name="close" size={17} /></button>
	</div>
	{#if tab === 'gifs'}
		<div class="gif-search"><Icon name="search" size={16} /><input type="search" bind:value={query} maxlength="80" aria-label="Поиск GIF" placeholder="Найти GIF…" enterkeyhint="search" /></div>
		<div class="gif-topics">{#each ['Коты', 'Смех', 'Танцы', 'Объятия'] as word}<button type="button" onclick={() => (query = word)}>{word}</button>{/each}</div>
	{/if}
	<div class="media-results">
		{#if tab === 'reactions'}
			<div class="emoji-grid">{#each PARTY_REACTIONS as emoji}<button type="button" aria-label="Реакция {emoji}" onclick={() => { sendReact(emoji); onClose(); }}>{emoji}</button>{/each}</div>
		{:else if tab === 'stickers'}
			<div class="sticker-grid">{#each PARTY_STICKERS as sticker}<button type="button" aria-label="Стикер {sticker.label}" onclick={() => { sendSticker(sticker.id); onClose(); }}><img src={sticker.src} alt="" width="90" height="110" /><span>{sticker.label}</span></button>{/each}</div>
			<p class="media-hint">Стикер появится поверх видео у всех в комнате.</p>
		{:else if loading}<p class="media-hint" role="status">Ищем GIF…</p>
		{:else if error}<p class="media-hint" role="alert">{error}</p><button type="button" class="retry" onclick={() => retry++}>Повторить поиск</button>
		{:else if !gifs.length}<p class="media-hint">Ничего не найдено. Попробуйте другой запрос, в том числе на английском.</p>
		{:else}
			<div class="gif-grid">{#each gifs as gif (gif.url)}<div class="gif-item"><button type="button" aria-label="Отправить GIF {gif.title}" onclick={() => { sendGif(gif); onClose(); }}><img src={gif.url} alt={gif.title} loading="lazy" referrerpolicy="no-referrer" /></button><a href={gif.source} target="_blank" rel="noopener noreferrer" title={`${gif.author} · ${gif.license}`}>{gif.license} · Источник ↗</a></div>{/each}</div>
		{/if}
	</div>
	{#if tab === 'gifs'}<p class="media-credit">Свободные GIF · <a href="https://commons.wikimedia.org" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a></p>{/if}
</section>

<style>
	.media-picker { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 8px; }
	.media-tabs { display: flex; gap: 4px; flex-shrink: 0; }
	.media-tabs button { min-height: 40px; padding: 0 12px; border-radius: 10px; font-size: 12px; color: #a4acba; }
	.media-tabs button[aria-pressed='true'] { background: #dce2eb; color: #111318; font-weight: 600; }
	.media-tabs .close-picker { margin-left: auto; padding-inline: 10px; }
	.media-results { min-height: 0; overflow-y: auto; overscroll-behavior: contain; flex: 1; padding-top: 8px; }
	.emoji-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; }
	.emoji-grid button { min-height: 44px; border-radius: 10px; font-size: 24px; }
	button:hover { background: #ffffff12; }
	button:focus-visible, a:focus-visible { outline: 2px solid #dce2eb; outline-offset: -2px; }
	.sticker-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
	.sticker-grid button { border: 1px solid #ffffff14; border-radius: 12px; padding: 4px; }
	.sticker-grid img { width: 100%; height: 90px; object-fit: contain; }
	.sticker-grid span { display: block; font-size: 11px; padding-bottom: 4px; }
	.gif-search { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-shrink: 0; border: 1px solid #ffffff20; border-radius: 12px; padding: 0 10px; }
	.gif-search input { min-width: 0; width: 100%; height: 42px; background: transparent; font-size: 16px; outline: none; }
	.gif-search:focus-within { border-color: #dce2eb; }
	.gif-topics { display: flex; flex-shrink: 0; gap: 4px; padding-top: 4px; }
	.gif-topics button { min-height: 32px; padding: 0 9px; font-size: 11px; border-radius: 8px; }
	.gif-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	.gif-item button { width: 100%; border-radius: 10px; overflow: hidden; background: #ffffff08; }
	.gif-item img { width: 100%; height: 95px; object-fit: contain; }
	.gif-item a { display: block; font-size: 9px; color: #a4acba; padding: 3px; overflow-wrap: anywhere; }
	.media-hint { padding: 12px 4px; color: #a4acba; font-size: 12px; line-height: 1.5; text-align: center; }
	.media-credit { flex-shrink: 0; padding-top: 6px; font-size: 10px; color: #a4acba; }
	.media-credit a { text-decoration: underline; }
	.retry { min-height: 44px; width: 100%; border-radius: 12px; background: #ffffff12; font-size: 12px; }
</style>
