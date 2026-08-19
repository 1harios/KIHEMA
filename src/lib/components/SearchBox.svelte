<script lang="ts">
	/**
	 * Поле поиска с живыми подсказками.
	 *
	 * Раньше поиск срабатывал только по Enter и уводил на страницу — то есть вёл
	 * себя как обычная форма. Теперь выдача падает списком под полем по мере
	 * ввода: тайтлы с миниатюрами и людьми отдельной группой.
	 *
	 * Клавиатура обязательна, а не «если останется время»: живой список, которым
	 * нельзя управлять стрелками, хуже простой формы. Стрелки ходят по плоскому
	 * списку (тайтлы, затем люди, затем строка «все результаты»), Enter открывает
	 * выделенное, Escape закрывает список и не трогает набранное.
	 *
	 * Логика запросов — в lib/search.svelte.ts: там задержка, отмена устаревших
	 * ответов и кеш.
	 */

	import { registerKeys } from '$lib/keys.svelte';
	import { goto } from '$app/navigation';
	import { search } from '$lib/search.svelte';
	import { toSlug } from '$lib/slug';
	import Icon from './ui/Icon.svelte';
	import RatingArc from './ui/RatingArc.svelte';

	interface Props {
		/** Нужен для мобильного слоя поиска: курсор сразу в поле после открытия. */
		autofocus?: boolean;
		onEscape?: () => void;
	}

	let { autofocus = false, onEscape }: Props = $props();

	let open = $state(false);
	let focused = $state(false);
	let activeIndex = $state(-1);
	let input: HTMLInputElement | null = $state(null);
	let root: HTMLDivElement | null = $state(null);

	const term = $derived(search.query.trim());

	/**
	 * Плоский список для навигации стрелками. Собирается из групп, потому что
	 * пользователь видит разделы, а стрелка должна ходить сквозь них подряд.
	 */
	type Row =
		| { kind: 'title'; href: string; label: string }
		| { kind: 'person'; href: string; label: string }
		| { kind: 'all'; href: string; label: string };

	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];

		for (const t of search.titles) {
			out.push({
				kind: 'title',
				href: `/${t.type === 'movie' ? 'movie' : 'show'}/${toSlug(t.tmdbId, t.title)}`,
				label: t.title
			});
		}
		for (const p of search.people) {
			out.push({ kind: 'person', href: `/person/${toSlug(p.id, p.name)}`, label: p.name });
		}
		if (term.length >= 2) {
			out.push({
				kind: 'all',
				href: `/search?q=${encodeURIComponent(term)}`,
				label: 'Все результаты'
			});
		}
		return out;
	});

	/** Индекс первой строки каждой группы — чтобы подсветка совпадала с рядами. */
	const peopleOffset = $derived(search.titles.length);

	const showHistory = $derived(open && term.length < 2 && search.history.length > 0);
	const showResults = $derived(open && term.length >= 2);

	$effect(() => {
		search.init();
	});

	$effect(() => {
		if (autofocus) queueMicrotask(() => input?.focus());
	});

	// Новая строка — выделение сбрасывается: иначе Enter откроет не то.
	$effect(() => {
		search.query;
		activeIndex = -1;
	});

	function go(href: string) {
		search.remember(term);
		open = false;
		activeIndex = -1;
		input?.blur();
		goto(href);
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (activeIndex >= 0 && rows[activeIndex]) {
			go(rows[activeIndex].href);
			return;
		}
		if (term.length >= 2) go(`/search?q=${encodeURIComponent(term)}`);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Список закрываем, набранное оставляем: стирать текст по Escape —
			// поведение, за которое пользователи ненавидят живой поиск.
			open = false;
			activeIndex = -1;
			onEscape?.();
			return;
		}

		if (!rows.length) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			activeIndex = (activeIndex + 1) % rows.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
			activeIndex = activeIndex <= 0 ? rows.length - 1 : activeIndex - 1;
		}
	}

	/** Клик мимо. На документе, а не оверлеем — оверлей ломает прокрутку. */
	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	/** Косая черта фокусирует поле — привычка из любого каталога. */
	/**
	 * Дробь ставит курсор в поле. Через общий реестр, а не свой обработчик окна:
	 * проверку «пользователь печатает» реестр делает сам, и клавиша попадает в
	 * панель подсказки вместе с остальными.
	 */
	$effect(() =>
		registerKeys({
			id: 'search',
			priority: 5,
			bindings: [
				{
					combos: ['/'],
					hint: '/',
					title: 'Поиск по каталогу',
					group: 'Общее',
					run: () => input?.focus()
				}
			]
		})
	);
</script>


<div bind:this={root} class="relative w-full">
	<form onsubmit={submit} role="search">
		<span
			class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition
			       {focused ? 'text-accent' : 'text-faint'}"
		>
			<Icon name="search" size={17} />
		</span>

		<input
			bind:this={input}
			value={search.query}
			oninput={(e) => {
				search.setQuery(e.currentTarget.value);
				open = true;
			}}
			onfocus={() => {
				focused = true;
				open = true;
			}}
			onblur={() => (focused = false)}
			onkeydown={onKeydown}
			type="text"
			autocomplete="off"
			placeholder="Фильмы, сериалы, люди"
			aria-label="Поиск"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={showResults || showHistory}
			aria-controls="search-suggest"
			class="h-10 w-full rounded-full border border-line-soft bg-surface pl-10 pr-20 text-sm
			       text-ink outline-none transition placeholder:text-faint focus:border-line-strong
			       focus:bg-surface-2 tv:h-14 tv:text-base"
		/>

		<div class="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
			{#if search.loading}
				<span
					class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line
					       border-t-accent"
					aria-label="Идёт поиск"
				></span>
			{:else if search.query}
				<button
					type="button"
					onclick={() => {
						search.reset();
						input?.focus();
					}}
					class="grid h-6 w-6 place-items-center rounded-full text-faint transition
					       hover:bg-surface-3 hover:text-ink"
					aria-label="Очистить"
				>
					<Icon name="close" size={14} />
				</button>
			{/if}
			<kbd
				class="pointer-events-none hidden rounded border border-line bg-surface-2 px-1.5 py-0.5
				       text-[10px] text-faint md:block"
				aria-hidden="true"
			>
				/
			</kbd>
		</div>
	</form>

	<!-- ============================== подсказки ============================= -->
	{#if showHistory || showResults}
		<div
			id="search-suggest"
			class="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-md
			       border border-line bg-elev py-1.5 shadow-4"
			role="listbox"
			aria-label="Подсказки поиска"
		>
			{#if showHistory}
				<div class="flex items-center justify-between px-3 pb-1.5 pt-1">
					<p class="eyebrow">Вы искали</p>
					<button
						type="button"
						onclick={() => search.clearHistory()}
						class="text-[11px] text-faint transition hover:text-bad"
					>
						очистить
					</button>
				</div>
				{#each search.history as h (h)}
					<button
						type="button"
						onclick={() => {
							search.setQuery(h);
							input?.focus();
						}}
						class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-dim
						       transition hover:bg-surface hover:text-ink"
					>
						<Icon name="clock" size={14} class="shrink-0 text-faint" />
						{h}
					</button>
				{/each}
			{:else if search.titles.length || search.people.length}
				{#if search.titles.length}
					<p class="eyebrow px-3 pb-1.5 pt-1">Фильмы и сериалы</p>
					{#each search.titles as t, i (t.type + t.tmdbId)}
						{@const href = `/${t.type === 'movie' ? 'movie' : 'show'}/${toSlug(t.tmdbId, t.title)}`}
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === i}
							onclick={() => go(href)}
							onmouseenter={() => (activeIndex = i)}
							class="flex w-full items-center gap-3 px-3 py-2 text-left transition
							       {activeIndex === i ? 'bg-surface' : ''}"
						>
							<div
								class="h-14 w-[2.35rem] shrink-0 overflow-hidden rounded-sm bg-surface-2
								       ring-1 ring-line-soft"
							>
								{#if t.poster}
									<img src={t.poster} alt="" loading="lazy" class="h-full w-full object-cover" />
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<p class="truncate text-[13.5px] font-medium text-ink">{t.title}</p>
								<p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
									<span>{t.type === 'movie' ? 'Фильм' : 'Сериал'}</span>
									{#if t.year}
										<span aria-hidden="true">·</span><span class="tnum">{t.year}</span>
									{/if}
									{#if t.originalTitle && t.originalTitle !== t.title}
										<span aria-hidden="true">·</span>
										<span class="truncate">{t.originalTitle}</span>
									{/if}
								</p>
							</div>

							{#if t.rating}
								<RatingArc value={t.rating} votes={t.votes} size={32} />
							{/if}
						</button>
					{/each}
				{/if}

				{#if search.people.length}
					<p class="eyebrow px-3 pb-1.5 pt-3">Люди</p>
					{#each search.people as p, i (p.id)}
						{@const idx = peopleOffset + i}
						{@const href = `/person/${toSlug(p.id, p.name)}`}
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === idx}
							onclick={() => go(href)}
							onmouseenter={() => (activeIndex = idx)}
							class="flex w-full items-center gap-3 px-3 py-2 text-left transition
							       {activeIndex === idx ? 'bg-surface' : ''}"
						>
							<div class="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-2">
								{#if p.photo}
									<img src={p.photo} alt="" loading="lazy" class="h-full w-full object-cover" />
								{:else}
									<span
										class="grid h-full place-items-center font-display text-sm text-faint"
										aria-hidden="true"
									>
										{p.name.charAt(0)}
									</span>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-[13.5px] font-medium text-ink">{p.name}</p>
								{#if p.knownFor}
									<p class="truncate text-[11px] text-faint">{p.knownFor}</p>
								{/if}
							</div>
						</button>
					{/each}
				{/if}

				<!-- Последняя строка навигации: уводит на полную выдачу. -->
				{@const allIndex = rows.length - 1}
				<div class="mt-1.5 border-t border-line-soft pt-1.5">
					<button
						type="button"
						role="option"
						aria-selected={activeIndex === allIndex}
						onclick={() => go(`/search?q=${encodeURIComponent(term)}`)}
						onmouseenter={() => (activeIndex = allIndex)}
						class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-accent
						       transition {activeIndex === allIndex ? 'bg-surface' : ''}"
					>
						<Icon name="search" size={14} class="shrink-0" />
						<span class="flex-1">Все результаты по «{term}»</span>
						{#if search.totalResults}
							<span class="tnum text-[11px] text-faint">
								{search.totalResults > 1000 ? '1000+' : search.totalResults}
							</span>
						{/if}
						<Icon name="chevronRight" size={14} class="shrink-0" />
					</button>
				</div>
			{:else if !search.loading}
				<p class="px-3 py-4 text-center text-[12.5px] text-dim">
					Ничего не нашлось по «{term}»
				</p>
			{/if}
		</div>
	{/if}
</div>
