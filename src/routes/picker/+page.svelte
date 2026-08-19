<script lang="ts">
	/**
	 * Мастер подбора.
	 *
	 * Пять шагов, на каждом — один вопрос. Не «ещё одна панель фильтров»: жанры
	 * отвечают на вопрос «что это», а человек, который не знает, что смотреть,
	 * думает категориями «хочу сломать голову» и «полтора часа, засыпаю».
	 *
	 * Поэтому первый шаг — настроения, собранные на ключевых словах TMDB
	 * (см. server/moods.ts). Ключевые слова точнее жанров: «временная петля» и
	 * «постапокалипсис» отбирают лучше, чем «фантастика».
	 *
	 * Финал — не список из двадцати постеров, а один ответ с кнопкой «ещё
	 * вариант». Список возвращает человека к той же проблеме выбора, с которой он
	 * сюда пришёл.
	 */

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Chip from '$lib/components/ui/Chip.svelte';
	import RatingArc from '$lib/components/ui/RatingArc.svelte';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import { DECADES, RATING_STEPS, RUNTIME_BUCKETS } from '$lib/filters';
	import { lists } from '$lib/lists.svelte';
	import GenreIcon from '$lib/components/ui/GenreIcon.svelte';
	import { toSlug } from '$lib/slug';
	import type { CatalogItem } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const url = $derived(page.url);

	const STEPS = [
		{ n: 1, label: 'Настроение' },
		{ n: 2, label: 'Жанры' },
		{ n: 3, label: 'Время' },
		{ n: 4, label: 'Качество' },
		{ n: 5, label: 'Где смотреть' }
	];

	/* --------------------------- работа с состоянием -------------------------- */

	/** Все переходы — обычные ссылки на тот же роут с другим query. */
	function to(changes: Record<string, string | number | null | undefined>): string {
		const p = new URLSearchParams(url.searchParams);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === undefined || v === '') p.delete(k);
			else p.set(k, String(v));
		}
		const qs = p.toString();
		return qs ? `/picker?${qs}` : '/picker';
	}

	function toggle(key: string, value: string | number): string {
		const raw = url.searchParams.get(key);
		const list = raw ? raw.split(',').filter(Boolean) : [];
		const str = String(value);
		const next = list.includes(str) ? list.filter((v) => v !== str) : [...list, str];
		return to({ [key]: next.length ? next.join(',') : null });
	}

	const has = (key: string, value: string | number) => {
		const raw = url.searchParams.get(key);
		return raw ? raw.split(',').includes(String(value)) : false;
	};

	/**
	 * Жанр выбирается обычным переключением, как и в фильтрах каталога: раньше
	 * здесь было три положения (нужен -> не нужен -> всё равно), и второе
	 * нажатие давало неожиданный результат. Исключения остались только у логики
	 * настроений на сервере, где они не требуют объяснений.
	 */
	const toggleGenre = (id: number): string => toggle('g', id);

	/* ------------------------------- результат ------------------------------- */

	let poolIndex = $state(0);
	let flipping = $state(false);

	/**
	 * Загрузчик возвращает две разные формы (шаг мастера и результат), и в
	 * объединённом типе PageData поля результата опциональны. Нормализуем их один
	 * раз здесь, чтобы дальше по разметке не расставлять проверки на undefined.
	 */
	const pool = $derived<CatalogItem[]>('pool' in data && data.pool ? data.pool : []);
	const relaxed = $derived<string[]>('relaxed' in data && data.relaxed ? data.relaxed : []);
	const totalResults = $derived('totalResults' in data ? (data.totalResults ?? 0) : 0);
	const pick = $derived(pool[poolIndex]);

	/** «Ещё» — это именно другие варианты, поэтому текущий из сетки исключаем. */
	const alternatives = $derived(pool.filter((_, i) => i !== poolIndex));

	// Новая выдача — снова с первой карточки.
	$effect(() => {
		url.search;
		poolIndex = 0;
	});

	function nextPick() {
		if (pool.length < 2) return;
		// Переворот карточки: 240мс — столько, чтобы жест читался, но не тормозил
		// перебор вариантов.
		flipping = true;
		setTimeout(() => {
			poolIndex = (poolIndex + 1) % pool.length;
			flipping = false;
		}, 240);
	}

	/** Пересобрать выдачу с другой случайной страницы. */
	function reroll() {
		goto(to({ step: 'result', seed: Date.now() % 10000 }), { noScroll: true });
	}

	const pickHref = $derived(
		pick ? `/${pick.type === 'movie' ? 'movie' : 'show'}/${toSlug(pick.tmdbId, pick.title)}` : '/'
	);

	/** «Показать все» — те же условия, но на странице каталога. */
	const catalogHref = $derived.by(() => {
		const p = new URLSearchParams();
		const s = data.state;
		if (s.genres.length) p.set('g', s.genres.join(','));
		if (s.excludeGenres.length) p.set('xg', s.excludeGenres.join(','));
		if (s.yearFrom) p.set('from', String(s.yearFrom));
		if (s.yearTo) p.set('to', String(s.yearTo));
		if (s.minRating) p.set('rating', String(s.minRating));
		if (s.providers.length) p.set('prov', s.providers.join(','));
		if (s.monetization.length) p.set('mon', s.monetization.join(','));
		if (s.runtime !== undefined) {
			const b = RUNTIME_BUCKETS[s.runtime];
			if (b?.from) p.set('rtf', String(b.from));
			if (b?.to) p.set('rtt', String(b.to));
		}
		const base = s.type === 'movie' ? '/catalog/movies' : '/catalog/shows';
		const qs = p.toString();
		return qs ? `${base}?${qs}` : base;
	});

	const inLater = $derived(pick ? lists.has('later', pick.tmdbId, pick.type) : false);
</script>

<svelte:head>
	<title>Подбор фильма — КИНЕМА</title>
	<meta
		name="description"
		content="Подбор фильма или сериала по настроению, времени и планке качества."
	/>
</svelte:head>

<main class="relative min-h-[80vh]">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-4xl px-[var(--gutter)] py-9 md:py-14">
		<!-- ============================ шапка мастера ========================= -->
		<header class="mb-9 text-center">
			<p class="eyebrow mb-3">Подбор</p>
			<h1 class="display-lg mb-3 text-3xl text-ink md:text-[2.75rem]">
				{#if data.isResult}
					Вот это
				{:else}
					{STEPS[data.step - 1].label}
				{/if}
			</h1>
			{#if !data.isResult}
				<p class="mx-auto max-w-md text-[13.5px] leading-relaxed text-dim">
					{#if data.step === 1}
						Чего хочется сегодня? Можно выбрать несколько — или пропустить шаг.
					{:else if data.step === 2}
						Клик по жанру: нужен, потом не нужен, потом всё равно.
					{:else if data.step === 3}
						Сколько у вас времени и из какой эпохи кино.
					{:else if data.step === 4}
						Насколько строго отсекать слабое.
					{:else}
						Где вам удобно смотреть. Шаг необязательный.
					{/if}
				</p>
			{/if}
		</header>

		<!-- ============================ индикатор шагов ======================== -->
		{#if !data.isResult}
			<nav class="mb-10 flex items-center justify-center gap-1.5" aria-label="Шаги подбора">
				{#each STEPS as s (s.n)}
					<a
						href={to({ step: s.n })}
						class="group flex items-center gap-1.5"
						aria-current={s.n === data.step ? 'step' : undefined}
						aria-label="Шаг {s.n}: {s.label}"
					>
						<span
							class="h-1.5 rounded-full transition-all duration-[var(--t-slow)]
							       {s.n === data.step
								? 'w-10 bg-accent'
								: s.n < data.step
									? 'w-5 bg-accent/45'
									: 'w-5 bg-line group-hover:bg-line-strong'}"
						></span>
					</a>
				{/each}
			</nav>
		{/if}

		<!-- ================================ шаги ============================== -->
		{#if !data.isResult}
			<!-- Тип: нужен на всех шагах, потому что от него зависят и жанры, и сервисы -->
			<div class="mb-8 flex justify-center gap-2">
				<Chip href={to({ type: 'movie', g: null, xg: null })} active={data.state.type === 'movie'}>
					<Icon name="film" size={14} />
					Фильм
				</Chip>
				<Chip href={to({ type: 'show', g: null, xg: null })} active={data.state.type === 'show'}>
					<Icon name="tv" size={14} />
					Сериал
				</Chip>
			</div>

			<div class="mb-11 min-h-[16rem]">
				{#if data.step === 1}
					<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
						{#each data.moods as mood (mood.id)}
							{@const active = has('mood', mood.id)}
							<a
								href={toggle('mood', mood.id)}
								class="group relative overflow-hidden rounded-md border p-4 text-left transition
								       {active
									? 'border-accent bg-accent-soft'
									: 'border-line-soft bg-surface/50 hover:border-line-strong hover:bg-surface'}"
								style={active ? 'box-shadow: var(--glow-sm)' : ''}
								aria-current={active ? 'true' : undefined}
							>
								<span class="mb-2.5 block text-2xl" aria-hidden="true">{mood.glyph}</span>
								<span
									class="mb-1 block text-[13.5px] font-semibold leading-tight
									       {active ? 'text-accent' : 'text-ink'}"
								>
									{mood.label}
								</span>
								<span class="block text-[11px] leading-snug text-faint">{mood.hint}</span>

								{#if active}
									<span
										class="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center
										       rounded-full bg-accent text-accent-ink"
									>
										<Icon name="check" size={11} />
									</span>
								{/if}
							</a>
						{/each}
					</div>
				{:else if data.step === 2}
					<div class="flex flex-wrap justify-center gap-2">
						{#each data.genres as g (g.id)}
							{@const on = has('g', g.id)}
							<a
								href={toggleGenre(g.id)}
								aria-current={on ? 'true' : undefined}
								class="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px]
								       transition duration-[var(--t-fast)] {on
									? 'border-accent bg-accent font-semibold text-accent-ink'
									: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
							>
								<GenreIcon id={g.id} size={14} variant="chip" />
								{g.name}
							</a>
						{/each}
					</div>
				{:else if data.step === 3}
					<div class="space-y-8">
						{#if data.state.type === 'movie'}
							<fieldset>
								<legend class="eyebrow mb-3.5 text-center">Сколько времени есть</legend>
								<div class="flex flex-wrap justify-center gap-2">
									{#each RUNTIME_BUCKETS as b, i (b.label)}
										<Chip
											href={to({ rt: data.state.runtime === i ? null : i })}
											active={data.state.runtime === i}
										>
											<Icon name="clock" size={13} />
											{b.label}
										</Chip>
									{/each}
								</div>
							</fieldset>
						{/if}

						<fieldset>
							<legend class="eyebrow mb-3.5 text-center">Эпоха</legend>
							<div class="flex flex-wrap justify-center gap-2">
								{#each DECADES.slice(0, 6) as d (d.from)}
									{@const active = data.state.yearFrom === d.from && data.state.yearTo === d.to}
									<Chip
										href={active
											? to({ from: null, to: null })
											: to({ from: d.from, to: d.to })}
										{active}
									>
										{d.label}
									</Chip>
								{/each}
								<Chip
									href={to({ from: null, to: null })}
									active={!data.state.yearFrom && !data.state.yearTo}
								>
									любая
								</Chip>
							</div>
						</fieldset>
					</div>
				{:else if data.step === 4}
					<fieldset>
						<legend class="eyebrow mb-3.5 text-center">Минимальный рейтинг</legend>
						<div class="flex flex-wrap justify-center gap-2">
							<Chip href={to({ rating: null })} active={!data.state.minRating}>
								не важно
							</Chip>
							{#each RATING_STEPS as r (r)}
								<Chip
									href={to({ rating: data.state.minRating === r ? null : r })}
									active={data.state.minRating === r}
								>
									<Icon name="star" size={12} />
									{r}+
								</Chip>
							{/each}
						</div>
						<p class="mx-auto mt-5 max-w-sm text-center text-[11.5px] leading-relaxed text-faint">
							Порог по числу оценок подставляется сам. Без него в подборку попадают тайтлы с
							оценкой 10 по двум голосам.
						</p>
					</fieldset>
				{:else}
					<div class="space-y-7">
						<fieldset>
							<legend class="eyebrow mb-3.5 text-center">Способ</legend>
							<div class="flex flex-wrap justify-center gap-2">
								{#each [{ v: 'flatrate', l: 'по подписке' }, { v: 'free', l: 'бесплатно' }, { v: 'ads', l: 'с рекламой' }, { v: 'rent', l: 'аренда' }] as m (m.v)}
									<Chip href={toggle('mon', m.v)} active={has('mon', m.v)}>{m.l}</Chip>
								{/each}
							</div>
						</fieldset>

						{#if data.providers.length}
							<fieldset>
								<legend class="eyebrow mb-3.5 text-center">Сервис</legend>
								<div class="flex flex-wrap justify-center gap-2">
									{#each data.providers.slice(0, 16) as p (p.id)}
										{@const active = has('prov', p.id)}
										<a
											href={toggle('prov', p.id)}
											title={p.name}
											aria-label={p.name}
											aria-current={active ? 'true' : undefined}
											class="h-11 w-11 overflow-hidden rounded-sm border transition
											       {active
												? 'border-accent ring-2 ring-accent/40'
												: 'border-line opacity-65 hover:opacity-100'}"
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
							</fieldset>
						{:else}
							<p class="mx-auto max-w-sm text-center text-[12px] leading-relaxed text-faint">
								Для вашего региона JustWatch не отдаёт список сервисов — этот шаг можно
								пропустить.
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- ============================ навигация ========================== -->
			<div class="flex items-center justify-between gap-3">
				{#if data.step > 1}
					<a
						href={to({ step: data.step - 1 })}
						class="inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-5
						       text-sm text-dim transition hover:border-line-strong hover:text-ink"
					>
						<Icon name="chevronLeft" size={15} />
						Назад
					</a>
				{:else}
					<span></span>
				{/if}

				<div class="flex items-center gap-2.5">
					{#if data.step < 5}
						<a
							href={to({ step: data.step + 1 })}
							class="text-xs text-faint transition hover:text-dim"
						>
							пропустить
						</a>
						<a
							href={to({ step: data.step + 1 })}
							class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
							       font-semibold text-accent-ink transition hover:bg-accent-hover"
							style="box-shadow: var(--glow-sm)"
						>
							Далее
							<Icon name="chevronRight" size={15} />
						</a>
					{:else}
						<a
							href={to({ step: 'result' })}
							class="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-8 text-sm
							       font-semibold text-accent-ink transition hover:bg-accent-hover"
							style="box-shadow: var(--glow-md)"
						>
							<Icon name="shuffle" size={17} />
							Подобрать
						</a>
					{/if}
				</div>
			</div>
		{:else}
			<!-- =============================== результат ======================== -->
			{#if pick}
				{#if relaxed.length}
					<!-- Честно говорим, что условия пришлось ослабить: иначе результат
					     выглядит так, будто мастер проигнорировал выбор. -->
					<div
						class="mx-auto mb-7 flex max-w-xl items-start gap-2.5 rounded-md border
						       border-warn/25 bg-warn/8 p-3.5 text-[12px] leading-relaxed text-warn"
						role="status"
					>
						<span class="mt-px shrink-0"><Icon name="info" size={14} /></span>
						<p>
							Точного совпадения не нашлось, поэтому пришлось ослабить
							{relaxed.join(', ')}. Попробуйте выбрать меньше условий.
						</p>
					</div>
				{/if}

				<div
					class="mx-auto max-w-2xl transition-all duration-[var(--t-mid)]
					       {flipping ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}"
				>
					<article
						class="overflow-hidden rounded-lg border border-line-soft bg-surface/50 shadow-3"
					>
						<a href={pickHref} class="group block">
							<div class="relative aspect-[16/9] overflow-hidden bg-surface">
								{#if pick.backdrop}
									<img
										src={pick.backdrop}
										alt=""
										class="h-full w-full object-cover transition-transform duration-[var(--t-slower)]
										       group-hover:scale-105"
										fetchpriority="high"
									/>
								{:else if pick.poster}
									<img src={pick.poster} alt="" class="h-full w-full object-cover" />
								{/if}
								<div
									class="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/25
									       to-transparent"
								></div>

								<div class="absolute inset-x-0 bottom-0 p-5 md:p-7">
									<div class="mb-3 flex items-center gap-3">
										{#if pick.rating}
											<RatingArc value={pick.rating} votes={pick.votes} size={42} />
										{/if}
										<div class="text-[11px] text-dim">
											<span class="uppercase tracking-wider">
												{pick.type === 'movie' ? 'Фильм' : 'Сериал'}
											</span>
											{#if pick.year}
												<span aria-hidden="true"> · </span><span class="tnum">{pick.year}</span>
											{/if}
										</div>
									</div>
									<h2
										class="display-lg text-2xl text-ink transition-colors
										       group-hover:text-accent md:text-4xl"
									>
										{pick.title}
									</h2>
								</div>
							</div>
						</a>

						{#if pick.overview}
							<div class="px-5 pt-5 md:px-7">
								<p class="line-clamp-4 text-[13.5px] leading-relaxed text-dim">
									{pick.overview}
								</p>
							</div>
						{/if}

						<div class="flex flex-wrap items-center gap-2.5 p-5 md:p-7">
							<a
								href={pickHref}
								class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
								       font-semibold text-accent-ink transition hover:bg-accent-hover"
							>
								<Icon name="play" size={15} />
								Беру
							</a>

							<button
								type="button"
								onclick={nextPick}
								disabled={pool.length < 2}
								class="inline-flex h-11 items-center gap-2 rounded-full border border-line
								       bg-surface px-5 text-sm text-ink transition hover:border-line-strong
								       hover:bg-surface-2 disabled:opacity-50"
							>
								<Icon name="shuffle" size={15} />
								Ещё вариант
							</button>

							<button
								type="button"
								onclick={() => lists.toggle('later', pick)}
								aria-pressed={inLater}
								title={inLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже'}
								class="grid h-11 w-11 place-items-center rounded-full border transition
								       {inLater
									? 'border-accent bg-accent text-accent-ink'
									: 'border-line bg-surface text-ink hover:border-line-strong'}"
							>
								<Icon name={inLater ? 'check' : 'bookmark'} size={16} />
							</button>

							<span class="tnum ml-auto text-[11px] text-faint">
								{poolIndex + 1} из {pool.length}
							</span>
						</div>
					</article>
				</div>

				<!-- Остальные варианты: не вместо ответа, а под ним -->
				{#if pool.length > 1}
					<section class="mt-12">
						<div class="mb-4 flex items-baseline justify-between gap-4">
							<h2 class="text-[15px] font-semibold text-ink">Ещё под эти условия</h2>
							<a href={catalogHref} class="text-xs text-dim transition hover:text-accent">
								Все
								{#if totalResults}
									<span class="tnum">
										{totalResults > 10000 ? '10 000+' : totalResults}
									</span>
								{/if}
							</a>
						</div>
						<div class="poster-grid">
							{#each alternatives.slice(0, 11) as item (item.type + item.tmdbId)}
								<MediaCard {item} width="100%" />
							{/each}
						</div>
					</section>
				{/if}

				<div class="mt-11 flex flex-wrap items-center justify-center gap-3">
					<button
						type="button"
						onclick={reroll}
						class="inline-flex h-10 items-center gap-2 rounded-full border border-line px-5
						       text-xs text-dim transition hover:border-line-strong hover:text-ink"
					>
						<Icon name="shuffle" size={14} />
						Другая подборка
					</button>
					<a
						href={to({ step: 1 })}
						class="inline-flex h-10 items-center gap-2 rounded-full border border-line px-5
						       text-xs text-dim transition hover:border-line-strong hover:text-ink"
					>
						<Icon name="sliders" size={14} />
						Изменить условия
					</a>
				</div>
			{:else}
				<!-- Совсем пусто: это возможно только в демо-режиме или при отказе API -->
				<div class="py-16 text-center">
					<p class="mb-2 text-[15px] text-ink">Ничего не нашлось</p>
					<p class="mx-auto mb-7 max-w-md text-[13px] leading-relaxed text-dim">
						Либо условия слишком узкие, либо каталог сейчас недоступен. Попробуйте убрать
						часть условий.
					</p>
					<a
						href={to({ step: 1 })}
						class="inline-flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold
						       text-accent-ink transition hover:bg-accent-hover"
					>
						Начать заново
					</a>
				</div>
			{/if}
		{/if}
	</div>
</main>
