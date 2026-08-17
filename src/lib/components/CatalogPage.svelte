<script lang="ts">
	/**
	 * Каталог. Один компонент на фильмы и сериалы — различия приезжают в data.type,
	 * а два почти одинаковых файла разъезжаются при первой же правке.
	 *
	 * Главная переделка этой версии — механизм подгрузки.
	 *
	 * Раньше на странице жили два несовместимых способа листать: кнопка «Показать
	 * ещё» догружала молча через /api/discover, а ниже стояли ссылки «Назад» и
	 * «Вперёд», которые делали полную навигацию и сбрасывали прокрутку наверх.
	 * Сортировка вообще шла через location.href, то есть перезагружала страницу.
	 * Любое из этих действий выглядело как рывок.
	 *
	 * Теперь механизм один: лента догружается сама при подходе к концу, кнопка
	 * остаётся явным дублёром, ссылочной пагинации нет. Автоподгрузка ограничена —
	 * иначе подвал становится недостижим, потому что лента растёт быстрее, чем до
	 * него доезжает прокрутка.
	 */

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import MediaCard from './MediaCard.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import Icon from './ui/Icon.svelte';
	import Select from './ui/Select.svelte';
	import { KEYS, buildUrl, describeActive, removeUrl, resetUrl } from '$lib/filters';
	import type { CatalogItem } from '$lib/types';
	import type { CatalogPageData } from '$lib/server/catalog-loader';

	let { data }: { data: CatalogPageData } = $props();

	const heading = $derived(data.type === 'movie' ? 'Фильмы' : 'Сериалы');
	const url = $derived(page.url);

	let filtersOpen = $state(false);

	/** Сколько раз лента догрузится сама, прежде чем отдать управление кнопке. */
	const AUTO_LIMIT = 5;

	/**
	 * Догруженное держим отдельно от data.items: при смене фильтров SvelteKit
	 * подменяет data, и накопленное должно обнулиться — за это отвечает $effect
	 * ниже, привязанный к строке запроса.
	 */
	let extra = $state<CatalogItem[]>([]);
	let nextPage = $state<number | null>(null);
	let autoUsed = $state(0);
	let loading = $state(false);
	let loadError = $state(false);

	$effect(() => {
		// Зависимость от полной строки запроса: любое изменение фильтров или
		// сортировки сбрасывает накопленное.
		url.search;
		extra = [];
		nextPage = data.nextPage;
		autoUsed = 0;
		loadError = false;
	});

	const items = $derived([...data.items, ...extra]);
	const hasMore = $derived(nextPage !== null);
	const autoExhausted = $derived(autoUsed >= AUTO_LIMIT);

	const genreNames = $derived(new Map(data.genres.map((g) => [g.id, g.name])));
	const activeChips = $derived(describeActive(data.filters, genreNames));

	async function loadMore(auto = false) {
		if (loading || nextPage === null) return;
		loading = true;
		loadError = false;

		const params = new URLSearchParams(url.searchParams);
		params.set('page', String(nextPage));
		params.set('type', data.type);

		try {
			const res = await fetch(`/api/discover?${params}`);
			if (!res.ok) throw new Error(String(res.status));
			const payload = (await res.json()) as {
				items: CatalogItem[];
				nextPage: number | null;
			};

			// Дедуп на клиенте тоже нужен: выдача Discover между запросами
			// перетасовывается, и один тайтл может приехать дважды.
			const seen = new Set(items.map((i) => `${i.type}:${i.tmdbId}`));
			extra = [...extra, ...payload.items.filter((i) => !seen.has(`${i.type}:${i.tmdbId}`))];
			nextPage = payload.nextPage;
			if (auto) autoUsed += 1;
		} catch {
			// Не молчим: без сообщения кнопка просто «не работает».
			loadError = true;
		} finally {
			loading = false;
		}
	}

	/** Сентинел перед концом списка: доехали до него — подгружаем. */
	function autoLoad(node: HTMLElement) {
		const io = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && !autoExhausted) loadMore(true);
			},
			// Запас в экран: карточки успевают приехать до того, как список кончится.
			{ rootMargin: '600px' }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

	/** Смена сортировки без перезагрузки и без прыжка наверх. */
	function applySort(value: string) {
		goto(buildUrl(url, { [KEYS.sort]: value }), { noScroll: true, keepFocus: true });
	}

	const totalLabel = $derived.by(() => {
		const n = data.totalResults;
		if (!n) return null;
		// TMDB не отдаёт больше 10 000 позиций (500 страниц по 20).
		return n > 10000 ? 'больше 10 000' : new Intl.NumberFormat('ru-RU').format(n);
	});
</script>

<svelte:head>
	<title>{heading} — КИНЕМА</title>
	<meta
		name="description"
		content="{heading}: подбор по жанрам, годам, длительности, рейтингу и стримингам."
	/>
</svelte:head>

<main class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-6 md:py-11">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative">
		<!--
			Шапка каталога.

			Была: заголовок и под ним строчка «Найдено 10» — два разрозненных куска,
			причём число висело само по себе и ни с чем не связывалось.

			Стало: одна строка. Слева тип каталога надзаголовком (он же говорит, где
			вы находитесь), под ним крупное название, а число найденного стоит рядом
			с названием на базовой линии — так оно читается как характеристика этого
			списка, а не как отдельное сообщение. Справка про активные условия
			появляется только когда они заданы, и говорит словами, а не цифрой.
		-->
		<header class="mb-5 md:mb-7">
			<p class="eyebrow mb-2 text-accent/70">Каталог</p>

			<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<h1 class="display-lg text-[1.75rem] text-ink md:text-[2.75rem] tv:text-[3.5rem]">
					{heading}
				</h1>
				{#if totalLabel}
					<p class="text-[13px] text-dim tv:text-lg">
						<span class="tnum text-[15px] font-semibold text-ink tv:text-2xl">{totalLabel}</span>
						{data.totalResults === 1 ? 'тайтл' : 'тайтлов'}
					</p>
				{/if}
			</div>

			{#if data.activeCount > 0}
				<p class="mt-2 text-[12.5px] text-faint tv:text-base">
					{data.activeCount === 1
						? 'Применено одно условие отбора'
						: `Применено условий отбора: ${data.activeCount}`}
				</p>
			{/if}
		</header>

		<!-- Панель управления. Прилипает к верху: при длинной ленте сортировка и
		     фильтры нужны на любой высоте прокрутки. -->
		<div
			class="glass sticky top-[var(--header-h)] z-30 -mx-[var(--gutter)] mb-5 border-y
			       border-line-soft px-[var(--gutter)] py-2.5 md:py-3"
		>
			<div
				class="no-scrollbar flex items-center gap-2 overflow-x-auto md:flex-wrap
				       md:overflow-visible"
			>
				<button
					type="button"
					onclick={() => (filtersOpen = !filtersOpen)}
					aria-expanded={filtersOpen}
					class="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs
					       transition tv:h-12 tv:px-5 tv:text-base {data.activeCount > 0
						? 'border-accent bg-accent font-semibold text-accent-ink'
						: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
				>
					<Icon name="sliders" size={15} />
					Фильтры
					{#if data.activeCount > 0}
						<span class="tnum">· {data.activeCount}</span>
					{/if}
				</button>

				<Select
					options={data.sortOptions}
					value={data.filters.sortBy ?? 'popularity.desc'}
					label="Сортировка"
					icon="list"
					onselect={applySort}
				/>

				{#if activeChips.length}
					<!-- Активные условия снимаются по одному: «сбросить всё» слишком
					     грубо, когда из шести условий мешает одно. -->
					<div class="ml-auto hidden flex-wrap items-center gap-1.5 lg:flex">
						{#each activeChips.slice(0, 5) as chip (chip.key)}
							<a
								href={removeUrl(url, chip.key)}
								class="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-soft
								       bg-surface px-2.5 text-[11px] text-dim transition hover:border-bad/50
								       hover:text-bad"
								title="Убрать условие"
							>
								{chip.label}
								<Icon name="close" size={11} />
							</a>
						{/each}
						{#if activeChips.length > 5}
							<span class="text-[11px] text-faint">+{activeChips.length - 5}</span>
						{/if}
						<a
							href={resetUrl(url)}
							class="ml-1 text-[11px] text-faint underline decoration-line-strong
							       underline-offset-2 transition hover:text-bad"
						>
							сбросить
						</a>
					</div>
				{/if}
			</div>
		</div>

		<div class="mb-7">
			<FilterPanel
				type={data.type}
				genres={data.genres}
				providers={data.providers}
				filters={data.filters}
				countries={data.countries}
				statuses={data.statuses}
				activeCount={data.activeCount}
				totalResults={data.totalResults}
				open={filtersOpen}
				onclose={() => (filtersOpen = false)}
			/>
		</div>

		{#if items.length}
			<div class="poster-grid">
				{#each items as item, i (item.type + item.tmdbId)}
					<MediaCard {item} width="100%" eager={i < 8} />
				{/each}
			</div>

			<!-- Сентинел автоподгрузки: стоит после сетки, но до кнопки. -->
			{#if hasMore && !autoExhausted}
				<div use:autoLoad class="h-px" aria-hidden="true"></div>
			{/if}

			<div class="mt-10 flex flex-col items-center gap-3">
				{#if loading}
					<span class="flex items-center gap-2 text-xs text-dim">
						<span
							class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-faint
							       border-t-accent"
							aria-hidden="true"
						></span>
						Загружаем
					</span>
				{:else if hasMore}
					<button
						type="button"
						onclick={() => loadMore(false)}
						class="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface
						       px-7 text-sm text-ink transition hover:border-line-strong hover:bg-surface-2
						       tv:h-14 tv:px-10 tv:text-lg"
					>
						Показать ещё
						<Icon name="chevronDown" size={15} />
					</button>
				{:else}
					<p class="text-xs text-faint">
						Это всё, что нашлось · <span class="tnum">{items.length}</span>
					</p>
				{/if}

				{#if loadError}
					<p class="text-xs text-bad">
						Не удалось догрузить список. Проверьте связь и нажмите ещё раз.
					</p>
				{/if}
			</div>
		{:else}
			<!-- Пустая выдача: объясняем причину и даём выход, а не просто «ничего не
			     найдено». Чаще всего виноват слишком узкий набор фильтров. -->
			<div class="py-20 text-center">
				<p class="mb-2 text-[15px] text-ink">По этим фильтрам ничего нет</p>
				<p class="mx-auto mb-6 max-w-md text-[13px] leading-relaxed text-dim">
					{#if data.activeCount > 2}
						Слишком узкое пересечение условий. Уберите одно-два — обычно виноваты
						одновременно выбранные жанры и высокая планка рейтинга.
					{:else}
						Попробуйте изменить условия подбора.
					{/if}
				</p>
				<a
					href={resetUrl(url)}
					class="inline-flex h-10 items-center rounded-full border border-line px-6 text-sm
					       text-ink transition hover:border-line-strong hover:bg-surface"
				>
					Сбросить фильтры
				</a>
			</div>
		{/if}
	</div>
</main>
