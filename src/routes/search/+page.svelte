<script lang="ts">
	/**
	 * Страница поиска.
	 *
	 * Что изменилось:
	 *
	 * — Вкладки «Все / Фильмы / Сериалы / Люди» вместо двух безымянных блоков.
	 *   Разделение по типу — первое, чего хочется в выдаче на сорок позиций.
	 * — Догрузка следующих страниц без перехода: раньше видна была только первая
	 *   двадцатка, и продолжения не существовало вовсе.
	 * — Люди идут отдельной вкладкой и своей сеткой: по запросу «Нолан» человек
	 *   ждёт режиссёра, а не фильм со словом «Нолан» в описании.
	 *
	 * Числа у вкладок — по загруженному, а не по всей выдаче TMDB, и это не
	 * упрощение: multi-поиск не умеет фильтровать по типу, поэтому сколько всего
	 * там фильмов против сериалов, до полной выкачки неизвестно. Показывать
	 * придуманное число хуже, чем честное «из загруженного».
	 */

	import { page } from '$app/state';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { search, type PersonHit } from '$lib/search.svelte';
	import { toSlug } from '$lib/slug';
	import type { CatalogItem } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const term = $derived(data.q.trim());

	type Tab = 'all' | 'movie' | 'show' | 'person';
	let tab = $state<Tab>('all');

	/** Догруженные страницы держим отдельно: data подменяется при новом запросе. */
	let extra = $state<CatalogItem[]>([]);
	let nextPage = $state(2);
	let loading = $state(false);
	let loadError = $state(false);

	$effect(() => {
		// Новый запрос — сбрасываем накопленное и вкладку.
		term;
		extra = [];
		nextPage = 2;
		loading = false;
		loadError = false;
		tab = 'all';

		// Запрос, до которого дошли по ссылке, тоже попадает в историю.
		if (term) search.remember(term);
	});

	const titles = $derived([...data.titles, ...extra]);
	const movies = $derived(titles.filter((t) => t.type === 'movie'));
	const shows = $derived(titles.filter((t) => t.type === 'show'));
	const people = $derived(data.people as PersonHit[]);

	const hasMore = $derived(nextPage <= data.totalPages);

	const visible = $derived(tab === 'movie' ? movies : tab === 'show' ? shows : titles);

	const tabs = $derived([
		{ id: 'all' as Tab, label: 'Все', count: titles.length + people.length },
		{ id: 'movie' as Tab, label: 'Фильмы', count: movies.length },
		{ id: 'show' as Tab, label: 'Сериалы', count: shows.length },
		{ id: 'person' as Tab, label: 'Люди', count: people.length }
	]);

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		loadError = false;

		try {
			const params = new URLSearchParams({ q: term, page: String(nextPage) });
			const res = await fetch(`/api/search?${params}`);
			if (!res.ok) throw new Error(String(res.status));
			const payload = (await res.json()) as { titles: CatalogItem[] };

			// Дедуп: multi-поиск между страницами иногда повторяет позиции.
			const seen = new Set(titles.map((t) => `${t.type}:${t.tmdbId}`));
			extra = [...extra, ...payload.titles.filter((t) => !seen.has(`${t.type}:${t.tmdbId}`))];
			nextPage += 1;
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}

	const nothingFound = $derived(Boolean(term) && !titles.length && !people.length);
</script>

<svelte:head>
	<title>{term ? `Поиск: ${term}` : 'Поиск'} — КИНЕМА</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-6 md:py-10">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative">
		<header class="mb-6">
			<p class="eyebrow mb-2">Поиск</p>
			<h1 class="display-lg text-[1.75rem] text-ink md:text-[2.5rem] tv:text-[3.25rem]">
				{#if term}
					{term}
				{:else}
					Что ищем?
				{/if}
			</h1>
			{#if term && data.totalResults}
				<p class="mt-2 text-[13px] text-dim">
					Всего в TMDB:
					<span class="tnum text-ink">
						{data.totalResults > 10000 ? 'больше 10 000' : data.totalResults}
					</span>
				</p>
			{/if}
		</header>

		{#if !term}
			<!-- Пустой запрос: не пустая страница, а точки входа. -->
			<div class="max-w-lg">
				<p class="mb-6 text-[13.5px] leading-relaxed text-dim">
					Введите название в поле сверху — подсказки появятся сразу, с постерами и людьми.
					Или начните не с названия, а с настроения.
				</p>

				{#if search.history.length}
					<p class="eyebrow mb-3">Вы искали</p>
					<div class="mb-8 flex flex-wrap gap-1.5">
						{#each search.history as h (h)}
							<a
								href="/search?q={encodeURIComponent(h)}"
								class="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3
								       text-xs text-dim transition hover:border-line-strong hover:text-ink"
							>
								<Icon name="clock" size={12} />
								{h}
							</a>
						{/each}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2.5">
					<a
						href="/picker"
						class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
						       font-semibold text-accent-ink transition hover:bg-accent-hover"
					>
						<Icon name="dice" size={16} />
						Подобрать по настроению
					</a>
					<a
						href="/catalog/movies"
						class="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm
						       text-ink transition hover:border-line-strong hover:bg-surface"
					>
						<Icon name="film" size={16} />
						Открыть каталог
					</a>
				</div>
			</div>
		{:else if nothingFound}
			<!-- Пустая выдача — самый частый исход неудачного запроса, и заканчиваться
			     она должна предложением, а не констатацией. -->
			<div class="max-w-lg py-8">
				<p class="mb-2 text-[15px] text-ink">Ничего не нашлось по «{term}»</p>
				<p class="mb-6 text-[13px] leading-relaxed text-dim">
					Проверьте раскладку и опечатки. Помогает искать по оригинальному названию — в базе
					TMDB оно основное, а русское подтягивается переводом.
				</p>
				<a
					href="/picker"
					class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
					       font-semibold text-accent-ink transition hover:bg-accent-hover"
				>
					<Icon name="dice" size={16} />
					Подобрать по настроению
				</a>
			</div>
		{:else}
			<!-- ============================== вкладки ============================= -->
			<div
				class="glass sticky top-[var(--header-h)] z-30 -mx-[var(--gutter)] mb-6 border-y
				       border-line-soft px-[var(--gutter)] py-2.5"
				role="tablist"
				aria-label="Тип результатов"
			>
				<div class="no-scrollbar flex gap-1.5 overflow-x-auto">
					{#each tabs as t (t.id)}
						{@const isActive = t.id === tab}
						<button
							type="button"
							role="tab"
							aria-selected={isActive}
							disabled={t.count === 0}
							onclick={() => (tab = t.id)}
							class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5
							       text-xs transition disabled:opacity-35 tv:h-12 tv:px-5 tv:text-base
							       {isActive
								? 'border-accent bg-accent font-semibold text-accent-ink'
								: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
						>
							{t.label}
							{#if t.count > 0}
								<span class="tnum opacity-70">{t.count}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- =============================== люди ============================== -->
			{#if people.length && (tab === 'all' || tab === 'person')}
				<section class="mb-10">
					{#if tab === 'all'}
						<h2 class="eyebrow mb-4">Люди</h2>
					{/if}

					<div
						class="{tab === 'person'
							? 'grid grid-cols-3 gap-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'
							: 'snap-row mask-fade-x -mx-[var(--gutter)] gap-5 px-[var(--gutter)]'}"
					>
						{#each people as person (person.id)}
							<!-- Адрес с хвостом-слагом, как у тайтлов: /person/[slug] читает
							     только числовой префикс, зато ссылку можно понять глазами. -->
							<a
								href="/person/{toSlug(person.id, person.name)}"
								class="lift group/person text-center {tab === 'person'
									? ''
									: 'w-[6.5rem] shrink-0 md:w-[7.5rem]'}"
								title={person.name}
							>
								<div
									class="mb-2.5 aspect-square overflow-hidden rounded-full bg-surface ring-1
									       ring-line-soft transition duration-[var(--t-slow)]
									       group-hover/person:ring-accent/45"
								>
									{#if person.photo}
										<img
											src={person.photo}
											alt=""
											loading="lazy"
											class="h-full w-full object-cover transition duration-[var(--t-slower)]
											       group-hover/person:scale-105"
										/>
									{:else}
										<span
											class="grid h-full place-items-center font-display text-xl text-faint"
											aria-hidden="true"
										>
											{person.name.charAt(0)}
										</span>
									{/if}
								</div>
								<p
									class="truncate text-[12.5px] font-medium text-ink transition
									       group-hover/person:text-accent"
								>
									{person.name}
								</p>
								{#if person.knownFor}
									<p class="line-clamp-2 text-[11px] leading-snug text-faint">
										{person.knownFor}
									</p>
								{/if}
							</a>
						{/each}
					</div>
				</section>
			{/if}

			<!-- ============================== тайтлы ============================= -->
			{#if tab !== 'person'}
				{#if visible.length}
					{#if tab === 'all' && people.length}
						<h2 class="eyebrow mb-4">Фильмы и сериалы</h2>
					{/if}

					<div class="poster-grid">
						{#each visible as item, i (item.type + item.tmdbId)}
							<MediaCard {item} width="100%" eager={i < 8} />
						{/each}
					</div>

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
								onclick={loadMore}
								class="inline-flex h-11 items-center gap-2 rounded-full border border-line
								       bg-surface px-7 text-sm text-ink transition hover:border-line-strong
								       hover:bg-surface-2"
							>
								Показать ещё
								<Icon name="chevronDown" size={15} />
							</button>
						{/if}

						{#if loadError}
							<p class="text-xs text-bad">Не удалось догрузить. Попробуйте ещё раз.</p>
						{/if}
					</div>
				{:else}
					<p class="py-12 text-center text-[13px] text-dim">
						{tab === 'movie' ? 'Фильмов' : 'Сериалов'} по этому запросу в загруженном нет.
						{#if hasMore}
							Попробуйте догрузить ещё — выдача TMDB не разделена по типу.
						{/if}
					</p>
					{#if hasMore}
						<div class="flex justify-center">
							<button
								type="button"
								onclick={loadMore}
								disabled={loading}
								class="inline-flex h-11 items-center gap-2 rounded-full border border-line
								       bg-surface px-7 text-sm text-ink transition hover:border-line-strong
								       disabled:opacity-55"
							>
								Показать ещё
								<Icon name="chevronDown" size={15} />
							</button>
						</div>
					{/if}
				{/if}
			{/if}
		{/if}
	</div>
</main>
