<script lang="ts">
	/**
	 * Чипс. Один компонент на все случаи: фильтры, метаданные, жанры, теги.
	 * Раньше каждый экран собирал свой вариант из шести классов Tailwind, и они
	 * незаметно расходились в радиусе и высоте.
	 */

	import type { Snippet } from 'svelte';

	interface Props {
		/** Ссылка. Если не задана — кнопка (или статичный тег при static). */
		href?: string;
		active?: boolean;
		/** Только подпись, без интерактивности. */
		static?: boolean;
		size?: 'sm' | 'md';
		tone?: 'default' | 'good' | 'ghost';
		title?: string;
		/** Переход без сброса прокрутки — для фильтров внутри длинной страницы. */
		noscroll?: boolean;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	}

	let {
		href,
		active = false,
		static: isStatic = false,
		size = 'md',
		tone = 'default',
		title,
		noscroll = false,
		onclick,
		children
	}: Props = $props();

	const sizing = $derived(
		size === 'sm' ? 'h-6 px-2 text-[11px] gap-1' : 'h-8 px-3 text-xs gap-1.5'
	);

	const look = $derived.by(() => {
		if (active) {
			return tone === 'good'
				? 'border-good/45 bg-good/12 text-good'
				: 'border-accent bg-accent text-accent-ink font-semibold';
		}
		if (tone === 'ghost') return 'border-transparent bg-surface text-dim hover:text-ink';
		return 'border-line text-dim hover:border-line-strong hover:text-ink';
	});

	const base = $derived(
		`inline-flex shrink-0 items-center rounded-full border whitespace-nowrap transition ${sizing} ${look}`
	);
</script>

{#if isStatic}
	<span class={base} {title}>{@render children()}</span>
{:else if href}
	<a
		{href}
		class={base}
		{title}
		aria-current={active ? 'true' : undefined}
		data-sveltekit-noscroll={noscroll ? '' : undefined}
	>
		{@render children()}
	</a>
{:else}
	<button type="button" class={base} {title} {onclick} aria-pressed={active}>
		{@render children()}
	</button>
{/if}
