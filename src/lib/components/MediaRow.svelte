<script lang="ts">
	/**
	 * Горизонтальный ряд карточек.
	 *
	 * Механика прокрутки (снап, стрелки, маска у краёв) живёт в RowShell — она
	 * общая с рядом «продолжить просмотр». Здесь остаётся только то, что
	 * специфично для постеров: нумерация топ-10 и ширина карточки.
	 */

	import type { CatalogItem } from '$lib/types';
	import MediaCard from './MediaCard.svelte';
	import RowShell from './RowShell.svelte';

	interface Props {
		title: string;
		items: CatalogItem[];
		href?: string;
		ranked?: boolean;
		/** Приоритетная загрузка картинок — только для первого ряда на странице. */
		eager?: boolean;
	}

	let { title, items, href, ranked = false, eager = false }: Props = $props();
</script>

{#if items.length}
	<RowShell {title} {href}>
		{#each items as item, i (item.type + item.tmdbId)}
			<!-- Ширина из переменной: на ТВ карточка растёт вместе с остальным
			     интерфейсом, а не остаётся маркой. -->
			<MediaCard
				{item}
				rank={ranked ? i + 1 : undefined}
				eager={eager && i < 6}
				width={ranked ? 'calc(var(--card-w) + var(--rank-w))' : 'var(--card-w)'}
			/>
		{/each}
	</RowShell>
{/if}
