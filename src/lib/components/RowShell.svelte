<script lang="ts">
	/**
	 * Каркас горизонтального ряда: заголовок, снап-прокрутка, стрелки, маска у
	 * краёв. Содержимое передаётся сниппетом.
	 *
	 * Выделен из MediaRow, когда появился ряд «продолжить просмотр»: у него другие
	 * карточки (широкие кадры вместо постеров) и другая правая кнопка в заголовке,
	 * но ровно та же механика прокрутки. Копировать её второй раз означало
	 * гарантированно получить два ряда, которые со временем разъедутся в поведении
	 * стрелок и порогах края.
	 */

	import type { Snippet } from 'svelte';
	import Icon from './ui/Icon.svelte';

	interface Props {
		title: string;
		/** Ссылка «Все» справка в заголовке. */
		href?: string;
		hrefLabel?: string;
		/** Своё содержимое справки в заголовке — вместо ссылки. */
		action?: Snippet;
		children: Snippet;
	}

	let { title, href, hrefLabel = 'Все', action, children }: Props = $props();

	let scroller: HTMLDivElement | null = $state(null);
	let atStart = $state(true);
	let atEnd = $state(false);

	function updateEdges() {
		if (!scroller) return;
		const { scrollLeft, scrollWidth, clientWidth } = scroller;
		atStart = scrollLeft < 8;
		// Запас в 8px: субпиксельная ширина иначе не даёт достичь конца ровно.
		atEnd = scrollLeft + clientWidth >= scrollWidth - 8;
	}

	function scrollByPage(dir: -1 | 1) {
		if (!scroller) return;
		// Листаем почти на экран, оставляя карточку для контекста.
		scroller.scrollBy({ left: dir * (scroller.clientWidth * 0.85), behavior: 'smooth' });
	}

	$effect(() => {
		if (!scroller) return;
		updateEdges();
		const ro = new ResizeObserver(updateEdges);
		ro.observe(scroller);
		return () => ro.disconnect();
	});
</script>

<section class="group/row relative">
	<div class="mb-3.5 flex items-baseline justify-between gap-4 px-[var(--gutter)]">
		<h2 class="text-[17px] font-semibold tracking-tight text-ink md:text-[19px] tv:text-2xl">
			{title}
		</h2>
		{#if action}
			{@render action()}
		{:else if href}
			<a
				{href}
				class="flex shrink-0 items-center gap-1 text-xs text-dim transition
				       duration-[var(--t-fast)] hover:text-accent"
			>
				{hrefLabel}
				<Icon name="chevronRight" size={14} />
			</a>
		{/if}
	</div>

	<div class="relative">
		<div
			bind:this={scroller}
			onscroll={updateEdges}
			class="snap-row mask-fade-x gap-4 px-[var(--gutter)] pb-3 pt-1"
		>
			{@render children()}
		</div>

		{#if !atStart}
			<button
				type="button"
				onclick={() => scrollByPage(-1)}
				aria-label="Прокрутить назад"
				class="absolute left-1 top-[34%] z-30 hidden h-11 w-11 -translate-y-1/2 place-items-center
				       rounded-full border border-white/10 bg-black/65 text-white opacity-0 backdrop-blur-md
				       transition duration-[var(--t-mid)] hover:border-white/25 hover:bg-black/85
				       group-hover/row:opacity-100 focus-visible:opacity-100 md:grid"
			>
				<Icon name="chevronLeft" size={22} />
			</button>
		{/if}

		{#if !atEnd}
			<button
				type="button"
				onclick={() => scrollByPage(1)}
				aria-label="Прокрутить вперёд"
				class="absolute right-1 top-[34%] z-30 hidden h-11 w-11 -translate-y-1/2 place-items-center
				       rounded-full border border-white/10 bg-black/65 text-white opacity-0 backdrop-blur-md
				       transition duration-[var(--t-mid)] hover:border-white/25 hover:bg-black/85
				       group-hover/row:opacity-100 focus-visible:opacity-100 md:grid"
			>
				<Icon name="chevronRight" size={22} />
			</button>
		{/if}
	</div>
</section>
