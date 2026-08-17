<script lang="ts">
	/**
	 * Страница ключевого слова.
	 *
	 * Это точка входа в каталог, а не отдельный раздел: тег с постера ведёт сюда,
	 * а отсюда — в подбор с уже проставленным фильтром. Поэтому здесь намеренно нет
	 * своих фильтров и сортировок; дублировать панель каталога ради одного
	 * параметра значит развести два места, которые потом разъедутся.
	 */

	import { page } from '$app/state';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { KEYS, pageUrl } from '$lib/filters';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Теги TMDB хранятся в нижнем регистре («time loop»), а заголовок страницы —
	    это имя собственное раздела, поэтому первую букву поднимаем. */
	const heading = $derived(
		data.keyword.name.charAt(0).toUpperCase() + data.keyword.name.slice(1)
	);

	function plural(n: number, one: string, few: string, many: string): string {
		const mod10 = n % 10;
		const mod100 = n % 100;
		if (mod10 === 1 && mod100 !== 11) return one;
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
		return many;
	}

	const totalLabel = $derived.by(() => {
		const n = data.totalResults;
		if (!n) return null;
		// TMDB не отдаёт больше 10 000 позиций (500 страниц по 20).
		return n > 10000 ? 'больше 10 000' : new Intl.NumberFormat('ru-RU').format(n);
	});

	const catalogHref = $derived(`/catalog/movies?${KEYS.keywords}=${data.keyword.id}`);
</script>

<svelte:head>
	<title>{heading} — КИНЕМА</title>
	<meta
		name="description"
		content="Фильмы с тегом «{data.keyword.name}» — подборка по ключевому слову TMDB."
	/>
</svelte:head>

<main class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-8 md:py-11">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative">
		<header class="mb-8 max-w-3xl">
			<p class="eyebrow mb-3">Ключевое слово</p>

			<h1 class="display-lg mb-3 text-3xl text-ink md:text-[2.75rem]">{heading}</h1>

			<p class="text-[13.5px] leading-relaxed text-dim">
				Фильмы, которым сообщество TMDB проставило этот тег. Теги точнее жанров — «временная
				петля» вместо «фантастики», — но заполняются вручную, поэтому подборка почти наверняка
				неполная.
				{#if totalLabel}
					Сейчас в подборке <span class="tnum text-ink">{totalLabel}</span>
					{plural(data.totalResults, 'фильм', 'фильма', 'фильмов')} — по популярности.
				{/if}
			</p>

			<div class="mt-5 flex flex-wrap items-center gap-2.5">
				<a
					href={catalogHref}
					class="inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-xs
					       text-dim transition hover:border-line-strong hover:text-ink"
				>
					<Icon name="sliders" size={14} />
					Уточнить в каталоге
				</a>
				<span class="text-[11.5px] text-faint">
					в каталоге к тегу можно добавить годы, рейтинг и жанры
				</span>
			</div>
		</header>

		{#if data.items.length}
			<div class="poster-grid">
				{#each data.items as item, i (item.type + item.tmdbId)}
					<MediaCard {item} width="100%" eager={i < 8} />
				{/each}
			</div>

			{#if data.totalPages > 1}
				<!-- Пагинация ссылками, а не догрузкой: страницу с тегом чаще пересылают,
				     чем прокручивают до конца. -->
				<nav class="mt-12 flex items-center justify-center gap-3 text-xs text-dim" aria-label="Страницы">
					{#if data.currentPage > 1}
						<a
							href={pageUrl(page.url, data.currentPage - 1)}
							class="inline-flex h-9 items-center gap-1 rounded-full border border-line px-4
							       transition hover:border-line-strong hover:text-ink"
						>
							<Icon name="chevronLeft" size={14} />
							Назад
						</a>
					{/if}

					<span class="tnum">Страница {data.currentPage} из {data.totalPages}</span>

					{#if data.currentPage < data.totalPages}
						<a
							href={pageUrl(page.url, data.currentPage + 1)}
							class="inline-flex h-9 items-center gap-1 rounded-full border border-line px-4
							       transition hover:border-line-strong hover:text-ink"
						>
							Вперёд
							<Icon name="chevronRight" size={14} />
						</a>
					{/if}
				</nav>
			{/if}
		{:else}
			<div class="py-20 text-center">
				<p class="mb-2 text-[15px] text-ink">Фильмов с этим тегом нет</p>
				<p class="mx-auto mb-6 max-w-md text-[13px] leading-relaxed text-dim">
					{#if data.currentPage > 1}
						Страница {data.currentPage} вышла за пределы выдачи — скорее всего, вы попали сюда по
						старой ссылке. Вернитесь к началу подборки.
					{:else}
						Тег в базе есть, но им отмечены только сериалы либо тайтлы, скрытые настройками
						региона. Это нормально: теги ставят вручную, и до фильмов очередь доходит не всегда.
					{/if}
				</p>
				<a
					href={data.currentPage > 1 ? pageUrl(page.url, 1) : catalogHref}
					class="inline-flex h-10 items-center rounded-full border border-line px-6 text-sm
					       text-ink transition hover:border-line-strong hover:bg-surface"
				>
					{data.currentPage > 1 ? 'В начало подборки' : 'Открыть каталог с этим тегом'}
				</a>
			</div>
		{/if}
	</div>
</main>
