<script lang="ts">
	/**
	 * Страница франшизы.
	 *
	 * Части выложены хронологической лентой, а не сеткой постеров. Смысл страницы
	 * франшизы ровно один — показать порядок: с чего начинать, что за чем идёт и
	 * где в ряду дыра, которой нет в медиатеке. Сетка этот порядок теряет, потому
	 * что читается как витрина равнозначных карточек.
	 */

	import Icon from '$lib/components/ui/Icon.svelte';
	import RatingArc from '$lib/components/ui/RatingArc.svelte';
	import { toSlug } from '$lib/slug';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const collection = $derived(data.collection);
	const parts = $derived(collection.parts);

	function plural(n: number, one: string, few: string, many: string): string {
		const mod10 = n % 10;
		const mod100 = n % 100;
		if (mod10 === 1 && mod100 !== 11) return one;
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
		return many;
	}

	const years = $derived(
		parts.map((p) => p.year).filter((y): y is number => typeof y === 'number' && y > 0)
	);

	/** Годы печатаем строкой, а не через Intl: разделитель разрядов превратил бы
	    1977 в «1 977». */
	const yearsLabel = $derived.by(() => {
		if (!years.length) return null;
		const from = Math.min(...years);
		const to = Math.max(...years);
		return from === to ? String(from) : `${from}–${to}`;
	});

	const rated = $derived(parts.filter((p) => p.rating && p.rating > 0));

	/** Средний балл франшизы. Считаем только по частям с рейтингом — иначе
	    неоценённый анонс тянет среднее к нулю. */
	const avgRating = $derived(
		rated.length ? rated.reduce((sum, p) => sum + (p.rating ?? 0), 0) / rated.length : null
	);

	const inLibraryCount = $derived(parts.filter((p) => p.inLibrary).length);

	const description = $derived(
		collection.overview?.slice(0, 160) ??
			`${collection.name}: все части по порядку, с годами и рейтингами.`
	);
</script>

<svelte:head>
	<title>{collection.name} — КИНЕМА</title>
	<meta name="description" content={description} />
</svelte:head>

<main class="pb-16 md:pb-20">
	<!-- Шапка с кадром -->
	<section class="relative">
		<div class="absolute inset-0 overflow-hidden">
			{#if collection.backdrop}
				<img
					src={collection.backdrop}
					alt=""
					fetchpriority="high"
					class="h-full w-full object-cover object-top"
				/>
			{:else}
				<div class="aurora" aria-hidden="true"></div>
			{/if}

			<!--
				Три градиента, как в герое главной: снизу — под стык с лентой, слева —
				под колонку с текстом, сверху — чтобы «стеклянная» шапка не висела на
				светлом кадре.
			-->
			<div class="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/35 to-transparent"></div>
			<div
				class="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/55 to-transparent
				       md:via-canvas/35"
			></div>
			<div class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-canvas/85 to-transparent"></div>
		</div>

		<div
			class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] pb-10 pt-14 md:pb-14
			       md:pt-24"
		>
			<p class="eyebrow mb-4">Франшиза</p>

			<h1 class="display-xl max-w-4xl text-4xl text-ink md:text-6xl">{collection.name}</h1>

			{#if collection.overview}
				<p class="mt-6 max-w-2xl text-sm leading-relaxed text-dim md:text-[15px]">
					{collection.overview}
				</p>
			{/if}

			{#if parts.length}
				<div class="mt-8 flex flex-wrap items-end gap-x-9 gap-y-5">
					<div>
						<p class="eyebrow mb-1.5">
							{plural(parts.length, 'Часть', 'Части', 'Частей')}
						</p>
						<p class="tnum text-xl font-semibold text-ink">{parts.length}</p>
					</div>

					{#if yearsLabel}
						<div>
							<p class="eyebrow mb-1.5">Годы</p>
							<p class="tnum text-xl font-semibold text-ink">{yearsLabel}</p>
						</div>
					{/if}

					{#if avgRating}
						<div>
							<p class="eyebrow mb-1.5">Средний балл</p>
							<div class="flex items-center gap-2.5">
								<RatingArc value={avgRating} size={40} />
								<span class="text-[12px] leading-tight text-dim">
									по {rated.length}
									{plural(rated.length, 'части', 'частям', 'частям')}
								</span>
							</div>
						</div>
					{/if}

					{#if inLibraryCount}
						<div>
							<p class="eyebrow mb-1.5">В медиатеке</p>
							<p class="tnum text-xl font-semibold text-ink">
								{inLibraryCount} <span class="text-base font-normal text-faint">из {parts.length}</span>
							</p>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</section>

	<div class="mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-9 md:py-12">
		{#if parts.length}
			<h2 class="mb-6 text-[17px] font-semibold tracking-tight text-ink md:text-[19px]">
				Порядок просмотра
			</h2>

			<!-- Лента. Нумерованный список не для красоты: порядок частей — это
			     содержание страницы, и он должен читаться скринридером. -->
			<ol class="max-w-4xl">
				{#each parts as part, i (part.tmdbId)}
					<li class="relative border-l border-line pb-5 pl-6 last:border-transparent last:pb-0 md:pl-9">
						<!-- Узел на линии. Часть из медиатеки помечаем заливкой акцентом:
						     на длинной ленте это единственный способ увидеть пропуски. -->
						<span
							class="absolute -left-[5px] top-7 h-2.5 w-2.5 rounded-full border
							       {part.inLibrary ? 'border-accent bg-accent' : 'border-line-strong bg-canvas'}"
							aria-hidden="true"
						></span>

						<a
							href="/movie/{toSlug(part.tmdbId, part.title)}"
							class="group flex gap-4 rounded-lg border border-line-soft bg-surface/45 p-3
							       transition hover:border-line-strong hover:bg-surface md:gap-6 md:p-4"
						>
							<div
								class="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-sm bg-surface-2 ring-1
								       ring-line-soft md:w-28 md:rounded-md"
							>
								{#if part.poster}
									<img
										src={part.poster}
										alt=""
										loading={i < 3 ? 'eager' : 'lazy'}
										decoding="async"
										class="h-full w-full object-cover transition-transform duration-[var(--t-slow)]
										       group-hover:scale-[1.04]"
									/>
								{:else}
									<div class="grid h-full w-full place-items-center text-faint">
										<Icon name="film" size={20} />
									</div>
								{/if}
							</div>

							<div class="flex min-w-0 flex-1 flex-col justify-center py-0.5">
								<div class="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
									<span class="eyebrow">
										Часть <span class="tnum">{i + 1}</span>
									</span>
									{#if part.year}
										<span class="text-faint" aria-hidden="true">·</span>
										<span class="tnum text-[11px] text-faint">{part.year}</span>
									{/if}
									{#if part.inLibrary}
										<span
											class="inline-flex h-5 items-center gap-1 rounded-full border border-accent/35
											       bg-accent-soft px-1.5 text-[10px] font-medium text-accent"
										>
											<Icon name="play" size={9} />
											В медиатеке
										</span>
									{/if}
								</div>

								<h3
									class="truncate text-[16px] font-semibold text-ink transition-colors
									       group-hover:text-accent md:text-[19px]"
								>
									{part.title}
								</h3>

								{#if part.overview}
									<p class="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-dim md:text-[13px]">
										{part.overview}
									</p>
								{:else}
									<p class="mt-1.5 text-[12.5px] text-faint">Описания на русском в TMDB нет</p>
								{/if}
							</div>

							{#if part.rating && part.rating > 0}
								<div class="hidden shrink-0 self-center sm:block">
									<RatingArc value={part.rating} votes={part.votes} size={42} />
								</div>
							{/if}
						</a>
					</li>
				{/each}
			</ol>
		{:else}
			<div class="py-16 text-center">
				<p class="mb-2 text-[15px] text-ink">Частей в этой франшизе пока нет</p>
				<p class="mx-auto max-w-md text-[13px] leading-relaxed text-dim">
					Карточка франшизы в TMDB заведена, но ни один фильм к ней не привязан. Обычно так
					бывает у анонсированных серий: коллекцию создают заранее, а фильмы добавляют по мере
					выхода.
				</p>
			</div>
		{/if}
	</div>
</main>
