<script lang="ts">
	/**
	 * Панель расширенных фильтров.
	 *
	 * Главное изменение этой версии — структура. Раньше семь групп условий шли
	 * подряд одной простынёй: на десктопе она занимала два экрана, и чтобы дойти
	 * до «Где смотреть», нужно было прокрутить мимо всего остального. Теперь
	 * категории вынесены в навигацию, а справа показываются контролы только
	 * выбранной. Панель укладывается в один экран, и видно, где условия уже
	 * заданы — у каждой категории свой счётчик.
	 *
	 * Остальные решения, которые стоит объяснить:
	 *
	 * — Жанр трёхпозиционный: нужен -> не нужен -> всё равно. «Фантастика, но не
	 *   хоррор» — частый запрос, и ради него не нужна вторая панель. Состояние
	 *   помечено знаком, а не только цветом: в монохроме цветом различать нечем.
	 *
	 * — Порог голосов подписан словами («известное»), а не числом. «1000 оценок»
	 *   ничего не значит для человека, который просто хочет отсечь мусор.
	 *
	 * — На телефоне панель это лист снизу, а категории — лента в его шапке.
	 *   Разворачивать двадцать условий внутри страницы нельзя: результаты уезжают
	 *   за экран, и непонятно, что изменилось. Кнопка с числом найденного внизу
	 *   листа и есть обратная связь.
	 */

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		DECADES,
		KEYS,
		LANGUAGES,
		MONETIZATION,
		RUNTIME_BUCKETS,
		VOTE_STEPS,
		buildUrl,
		isGenreOn,
		readList,
		readStrList,
		resetUrl,
		toggleGenre,
		toggleInList
	} from '$lib/filters';
	import type { DiscoverFilters, MediaType, WatchProvider } from '$lib/types';
	import Chip from './ui/Chip.svelte';
	import GenreIcon from './ui/GenreIcon.svelte';
	import Icon, { type IconName } from './ui/Icon.svelte';

	interface Props {
		type: MediaType;
		genres: { id: number; name: string }[];
		providers: WatchProvider[];
		filters: DiscoverFilters;
		countries: readonly { code: string; name: string }[];
		statuses: readonly { value: number; label: string }[];
		activeCount: number;
		totalResults: number;
		open: boolean;
		onclose: () => void;
	}

	let {
		type,
		genres,
		providers,
		filters,
		countries,
		statuses,
		activeCount,
		totalResults,
		open,
		onclose
	}: Props = $props();

	const url = $derived(page.url);

	const activeProviders = $derived(readList(url, KEYS.providers));
	const activeMon = $derived(readStrList(url, KEYS.monetization));
	const activeStatus = $derived(readList(url, KEYS.status));

	const CURRENT_YEAR = new Date().getFullYear();
	const MIN_YEAR = 1950;

	/* ------------------------------- категории ------------------------------- */

	type TabId = 'genres' | 'years' | 'runtime' | 'quality' | 'origin' | 'where' | 'status';

	const tabs = $derived.by(() => {
		const list: { id: TabId; label: string; icon: IconName; count: number }[] = [
			{
				id: 'genres',
				label: 'Жанры',
				icon: 'grid',
				count: filters.genres?.length ?? 0
			},
			{ id: 'years', label: 'Годы', icon: 'calendar', count: filters.yearFrom || filters.yearTo ? 1 : 0 }
		];

		// Длительность серии для сериала — величина почти бесполезная: у эпизодов
		// она одинаковая внутри сериала, фильтровать по ней нечего.
		if (type === 'movie') {
			list.push({
				id: 'runtime',
				label: 'Длительность',
				icon: 'clock',
				count: filters.runtimeFrom || filters.runtimeTo ? 1 : 0
			});
		}

		list.push(
			{
				id: 'quality',
				label: 'Качество',
				icon: 'star',
				count: (filters.minRating ? 1 : 0) + (filters.minVotes ? 1 : 0)
			},
			{
				id: 'origin',
				label: 'Происхождение',
				icon: 'globe',
				count: (filters.country ? 1 : 0) + (filters.language ? 1 : 0)
			},
			{
				id: 'where',
				label: 'Где смотреть',
				icon: 'tv',
				count: (filters.providers?.length ? 1 : 0) + (filters.monetization?.length ? 1 : 0)
			}
		);

		if (type === 'show') {
			list.push({
				id: 'status',
				label: 'Статус',
				icon: 'list',
				count: filters.showStatus?.length ? 1 : 0
			});
		}

		return list;
	});

	let tab = $state<TabId>('genres');

	// Тип сменился (фильмы <-> сериалы) — вкладки другие, и выбранной могло не
	// остаться. Без сброса панель показала бы пустоту.
	$effect(() => {
		if (!tabs.some((t) => t.id === tab)) tab = 'genres';
	});

	/* -------------------------------- ползунки ------------------------------- */

	/**
	 * Значения живут локально, пока ползунок тянут: навигация на каждый пиксель
	 * перетаскивания — это сотня запросов к TMDB. Применяем по отпусканию
	 * (событие change), а не по движению (input).
	 */
	let yearFrom = $state(MIN_YEAR);
	let yearTo = $state(CURRENT_YEAR);
	let rating = $state(0);

	$effect(() => {
		yearFrom = filters.yearFrom ?? MIN_YEAR;
		yearTo = filters.yearTo ?? CURRENT_YEAR;
		rating = filters.minRating ?? 0;
	});

	/** Доля заполнения трека — её читает CSS через --fill. */
	const pct = (value: number, min: number, max: number) =>
		`${Math.round(((value - min) / (max - min)) * 100)}%`;

	function applyYears() {
		// Перевёрнутый диапазон — обычная ошибка при двух ползунках, правим молча.
		const lo = Math.min(yearFrom, yearTo);
		const hi = Math.max(yearFrom, yearTo);
		goto(
			buildUrl(url, {
				[KEYS.yearFrom]: lo > MIN_YEAR ? lo : null,
				[KEYS.yearTo]: hi < CURRENT_YEAR ? hi : null
			}),
			{ noScroll: true, keepFocus: true }
		);
	}

	function applyRating() {
		goto(buildUrl(url, { [KEYS.rating]: rating > 0 ? rating : null }), {
			noScroll: true,
			keepFocus: true
		});
	}

	const decadeActive = (from: number, to: number) =>
		filters.yearFrom === from && filters.yearTo === to;

	const runtimeActive = (from?: number, to?: number) =>
		filters.runtimeFrom === from && filters.runtimeTo === to;

	const countLabel = $derived(
		totalResults > 10000 ? '10 000+' : new Intl.NumberFormat('ru-RU').format(totalResults)
	);
</script>

<!-- ============================= контролы вкладок ========================== -->
{#snippet controls()}
	{#if tab === 'genres'}
		<!--
			Плитки с иконками вместо ряда пилюль. Девятнадцать одинаковых текстовых
			пилюль сканируются построчно, то есть читаются целиком; сетка с графикой
			находится по силуэту, и на второй раз человек уже не читает подписи.

			Выбор простой: нажал — жанр в отборе, нажал ещё раз — вышел, выбрать
			можно сколько угодно. Прежнее третье положение («не нужен») требовало
			подписи-инструкции над сеткой, а без неё второе нажатие выглядело сбоем.
		-->
		<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 tv:grid-cols-6">
			{#each genres as g (g.id)}
				{@const on = isGenreOn(url, g.id)}
				<a
					href={toggleGenre(url, g.id)}
					data-sveltekit-noscroll
					aria-current={on ? 'true' : undefined}
					title={on ? `${g.name}: убрать из отбора` : `${g.name}: добавить в отбор`}
					class="relative flex flex-col items-center justify-center gap-2 rounded-md border p-3
					       text-center transition duration-[var(--t-fast)] tv:gap-3 tv:p-5 {on
						? 'border-accent bg-accent-soft text-accent'
						: 'border-line-soft bg-surface/40 text-dim hover:border-line-strong hover:bg-surface hover:text-ink'}"
				>
					{#if on}
						<!-- Галочка, а не только цвет: в монохромной теме одного оттенка
						     для состояния мало. -->
						<span
							class="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full
							       bg-accent text-accent-ink"
						>
							<Icon name="check" size={10} />
						</span>
					{/if}

					<GenreIcon id={g.id} size={21} variant="tile" class="tv:scale-125" />
					<span class="text-[11.5px] font-medium leading-tight tv:text-base">{g.name}</span>
				</a>
			{/each}
		</div>

		{#if (filters.genres?.length ?? 0) > 1}
			<!-- AND vs OR. Разница в выдаче огромная, а TMDB нигде не подсказывает,
			     что запятая и вертикальная черта дают разное. -->
			<div class="mt-4 flex items-center gap-2 border-t border-line-soft pt-4">
				<Chip
					href={buildUrl(url, { [KEYS.matchAll]: filters.genresMatchAll ? null : '1' })}
					active={filters.genresMatchAll}
					size="sm"
				>
					<Icon name={filters.genresMatchAll ? 'check' : 'plus'} size={11} />
					{filters.genresMatchAll ? 'все выбранные сразу' : 'любой из выбранных'}
				</Chip>
				<span class="text-[11px] text-faint">
					{filters.genresMatchAll ? 'строже: тайтл должен быть во всех жанрах' : 'шире: хватит одного'}
				</span>
			</div>
		{/if}
	{:else if tab === 'years'}
		<div class="mb-6 flex flex-wrap gap-1.5">
			{#each DECADES as d (d.from)}
				<Chip
					href={decadeActive(d.from, d.to)
						? buildUrl(url, { [KEYS.yearFrom]: null, [KEYS.yearTo]: null })
						: buildUrl(url, { [KEYS.yearFrom]: d.from, [KEYS.yearTo]: d.to })}
					active={decadeActive(d.from, d.to)}
					size="sm"
				>
					{d.label}
				</Chip>
			{/each}
		</div>

		<div class="max-w-md space-y-5">
			<label class="block">
				<span class="mb-1.5 flex justify-between text-[11px]">
					<span class="text-faint">не раньше</span>
					<span class="tnum font-semibold text-ink">{yearFrom}</span>
				</span>
				<input
					type="range"
					min={MIN_YEAR}
					max={CURRENT_YEAR}
					bind:value={yearFrom}
					onchange={applyYears}
					class="range"
					style="--fill: {pct(yearFrom, MIN_YEAR, CURRENT_YEAR)}"
					aria-label="Год от"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 flex justify-between text-[11px]">
					<span class="text-faint">не позже</span>
					<span class="tnum font-semibold text-ink">{yearTo}</span>
				</span>
				<input
					type="range"
					min={MIN_YEAR}
					max={CURRENT_YEAR}
					bind:value={yearTo}
					onchange={applyYears}
					class="range"
					style="--fill: {pct(yearTo, MIN_YEAR, CURRENT_YEAR)}"
					aria-label="Год до"
				/>
			</label>
		</div>
	{:else if tab === 'runtime'}
		<div class="flex flex-wrap gap-1.5">
			{#each RUNTIME_BUCKETS as b (b.label)}
				<Chip
					href={runtimeActive(b.from, b.to)
						? buildUrl(url, { [KEYS.runtimeFrom]: null, [KEYS.runtimeTo]: null })
						: buildUrl(url, {
								[KEYS.runtimeFrom]: b.from ?? null,
								[KEYS.runtimeTo]: b.to ?? null
							})}
					active={runtimeActive(b.from, b.to)}
					size="sm"
				>
					<Icon name="clock" size={11} />
					{b.label}
				</Chip>
			{/each}
		</div>
	{:else if tab === 'quality'}
		<div class="max-w-md">
			<label class="mb-6 block">
				<span class="mb-1.5 flex justify-between text-[11px]">
					<span class="text-faint">рейтинг не ниже</span>
					<span class="tnum font-semibold text-ink">
						{rating > 0 ? rating.toFixed(1) : 'не важно'}
					</span>
				</span>
				<input
					type="range"
					min="0"
					max="9"
					step="0.5"
					bind:value={rating}
					onchange={applyRating}
					class="range"
					style="--fill: {pct(rating, 0, 9)}"
					aria-label="Минимальный рейтинг"
				/>
			</label>

			<p class="eyebrow mb-2.5">Насколько известное</p>
			<div class="mb-3 flex flex-wrap gap-1.5">
				{#each VOTE_STEPS as v (v.value)}
					<Chip
						href={buildUrl(url, { [KEYS.votes]: filters.minVotes === v.value ? null : v.value })}
						active={filters.minVotes === v.value}
						size="sm"
						title="{v.value}+ оценок на TMDB"
					>
						{v.label}
					</Chip>
				{/each}
			</div>
			<p class="text-[11px] leading-relaxed text-faint">
				При сортировке по рейтингу порог подставляется сам — иначе наверху окажутся тайтлы с
				оценкой 10 по двум голосам.
			</p>
		</div>
	{:else if tab === 'origin'}
		<p class="eyebrow mb-2.5">Страна производства</p>
		<div class="mb-6 flex flex-wrap gap-1.5">
			{#each countries as c (c.code)}
				<Chip
					href={buildUrl(url, { [KEYS.country]: filters.country === c.code ? null : c.code })}
					active={filters.country === c.code}
					size="sm"
				>
					{c.name}
				</Chip>
			{/each}
		</div>

		<p class="eyebrow mb-2.5">Язык оригинала</p>
		<div class="flex flex-wrap gap-1.5">
			{#each LANGUAGES as l (l.code)}
				<Chip
					href={buildUrl(url, { [KEYS.language]: filters.language === l.code ? null : l.code })}
					active={filters.language === l.code}
					size="sm"
				>
					{l.name}
				</Chip>
			{/each}
		</div>
	{:else if tab === 'where'}
		<p class="eyebrow mb-2.5">Способ просмотра</p>
		<div class="mb-6 flex flex-wrap gap-1.5">
			{#each MONETIZATION as m (m.value)}
				<Chip
					href={toggleInList(url, KEYS.monetization, m.value)}
					active={activeMon.includes(m.value)}
					size="sm"
				>
					{m.label}
				</Chip>
			{/each}
		</div>

		{#if providers.length}
			<p class="eyebrow mb-2.5">Сервис</p>
			<div class="flex flex-wrap gap-2">
				{#each providers as p (p.id)}
					{@const active = activeProviders.includes(p.id)}
					<a
						href={toggleInList(url, KEYS.providers, p.id)}
						data-sveltekit-noscroll
						title={p.name}
						aria-label={p.name}
						aria-current={active ? 'true' : undefined}
						class="h-11 w-11 overflow-hidden rounded-sm border transition tv:h-14 tv:w-14 {active
							? 'border-accent ring-2 ring-accent/40'
							: 'border-line opacity-60 hover:opacity-100'}"
					>
						{#if p.logo}
							<img src={p.logo} alt="" class="h-full w-full object-cover" loading="lazy" />
						{:else}
							<span class="grid h-full place-items-center text-[9px] text-dim">
								{p.name.slice(0, 4)}
							</span>
						{/if}
					</a>
				{/each}
			</div>
		{:else}
			<!-- Пустой список провайдеров — ожидаемое состояние, а не поломка:
			     покрытие JustWatch в регионе может быть почти нулевым. -->
			<p class="max-w-sm text-[11.5px] leading-relaxed text-faint">
				Для текущего региона JustWatch не отдаёт список сервисов. Фильтр по способу просмотра
				выше всё равно работает.
			</p>
		{/if}
	{:else if tab === 'status'}
		<div class="flex flex-wrap gap-1.5">
			{#each statuses as s (s.value)}
				<Chip
					href={toggleInList(url, KEYS.status, s.value)}
					active={activeStatus.includes(s.value)}
					size="sm"
				>
					{s.label}
				</Chip>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- ========================= панель: планшет и выше ======================== -->
{#if open}
	<div class="hidden md:block">
		<div class="overflow-hidden rounded-lg border border-line-soft bg-surface/40">
			<div class="flex">
				<!-- Категории. Вертикальные вкладки, потому что подписи разной длины:
				     горизонтально они рвутся на две строки и панель дёргается. -->
				<nav
					class="w-48 shrink-0 border-r border-line-soft py-3 tv:w-64"
					aria-label="Категории фильтров"
				>
					{#each tabs as t (t.id)}
						{@const isActive = t.id === tab}
						<button
							type="button"
							onclick={() => (tab = t.id)}
							aria-current={isActive ? 'true' : undefined}
							class="relative flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px]
							       transition tv:py-4 tv:text-base {isActive
								? 'bg-accent-soft text-accent'
								: 'text-dim hover:bg-surface hover:text-ink'}"
						>
							{#if isActive}
								<span class="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-accent"></span>
							{/if}
							<Icon name={t.icon} size={15} class="shrink-0" />
							<span class="flex-1 truncate">{t.label}</span>
							{#if t.count > 0}
								<span
									class="tnum grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1
									       text-[10px] font-bold text-accent-ink"
								>
									{t.count}
								</span>
							{/if}
						</button>
					{/each}
				</nav>

				<div class="min-w-0 flex-1 p-5 md:p-6">
					{@render controls()}
				</div>
			</div>

			<!-- Низ панели: сброс и живой счётчик. Раньше числа найденного здесь не
			     было, и эффект от условий приходилось искать глазами в сетке. -->
			<div
				class="flex items-center justify-between gap-4 border-t border-line-soft bg-canvas/40
				       px-5 py-3.5"
			>
				{#if activeCount > 0}
					<a
						href={resetUrl(url)}
						class="inline-flex items-center gap-1.5 text-xs text-dim transition hover:text-bad"
					>
						<Icon name="close" size={13} />
						Сбросить всё
						<span class="tnum">({activeCount})</span>
					</a>
				{:else}
					<span class="text-[11px] text-faint">Условия не заданы</span>
				{/if}

				<span class="text-xs text-dim">
					Найдено <span class="tnum font-semibold text-ink">{countLabel}</span>
				</span>
			</div>
		</div>
	</div>
{/if}

<!-- ============================ лист на телефоне =========================== -->
{#if open}
	<!-- Затемнение. Кнопка, а не div: закрытие по нажатию мимо должно работать и с
	     клавиатуры. -->
	<button
		type="button"
		class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm md:hidden"
		onclick={onclose}
		aria-label="Закрыть фильтры"
	></button>

	<div
		class="fixed inset-x-0 bottom-0 z-[61] flex max-h-[88dvh] flex-col rounded-t-xl border-t
		       border-line bg-elev md:hidden"
		role="dialog"
		aria-modal="true"
		aria-label="Фильтры"
	>
		<div class="flex items-center justify-between border-b border-line-soft px-4 py-3">
			<h2 class="text-[15px] font-semibold text-ink">Фильтры</h2>
			<button
				type="button"
				onclick={onclose}
				class="grid h-9 w-9 place-items-center rounded-full text-dim transition hover:bg-surface
				       hover:text-ink"
				aria-label="Закрыть"
			>
				<Icon name="close" size={18} />
			</button>
		</div>

		<!-- Категории лентой: на 390px вертикальные вкладки съели бы половину ширины. -->
		<div
			class="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line-soft px-4 py-2.5"
			role="tablist"
			aria-label="Категории фильтров"
		>
			{#each tabs as t (t.id)}
				{@const isActive = t.id === tab}
				<button
					type="button"
					role="tab"
					aria-selected={isActive}
					onclick={() => (tab = t.id)}
					class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs
					       transition {isActive
						? 'border-accent bg-accent font-semibold text-accent-ink'
						: 'border-line text-dim'}"
				>
					<Icon name={t.icon} size={13} />
					{t.label}
					{#if t.count > 0}
						<span class="tnum opacity-70">· {t.count}</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-5">
			{@render controls()}
		</div>

		<!-- Закреплённый низ: число найденного здесь — единственная обратная связь
		     на телефоне, где результаты не видны за листом. -->
		<div
			class="flex items-center gap-3 border-t border-line-soft px-4 py-3
			       pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
		>
			<a
				href={resetUrl(url)}
				class="inline-flex h-11 items-center rounded-full border border-line px-4 text-xs text-dim"
			>
				Сбросить
			</a>
			<button
				type="button"
				onclick={onclose}
				class="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent
				       text-sm font-semibold text-accent-ink"
			>
				Показать
				{#if totalResults}<span class="tnum">{countLabel}</span>{/if}
			</button>
		</div>
	</div>
{/if}
