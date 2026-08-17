<script lang="ts">
	/**
	 * «Моё» — личные списки.
	 *
	 * Страница принципиально клиентская: списки лежат в localStorage (почему
	 * именно так — см. шапку lists.svelte.ts), на сервере их не существует.
	 * Отсюда две неочевидные вещи в разметке.
	 *
	 * Первая: вкладки — ссылки с ?kind=, а не кнопки. Состояние в URL можно
	 * переслать, положить в закладки и открыть кнопкой «назад»; локальный флаг
	 * ничего из этого не умеет.
	 *
	 * Вторая: до гидрации рисуем скелетоны. Без них пользователь с полным списком
	 * успевает увидеть «здесь пусто» — SSR отдаёт нули, и пустое состояние
	 * мигает ровно до первого $effect.
	 */

	import { page } from '$app/state';
	import MediaCard from '$lib/components/MediaCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { entryToItem, initLists, lists } from '$lib/lists.svelte';
	import { LIST_KINDS, LIST_LABELS, type ListKind } from '$lib/types';

	const kind = $derived.by(() => {
		const raw = page.url.searchParams.get('kind') ?? '';
		// includes() у readonly-кортежа требует свой же литеральный тип — здесь
		// на входе произвольная строка из URL, поэтому сверяемся как со строками.
		return (LIST_KINDS as readonly string[]).includes(raw) ? (raw as ListKind) : 'later';
	});

	let mounted = $state(false);

	$effect(() => {
		initLists();
		mounted = true;
	});

	/**
	 * Сортируем копию, а не сам массив стора: сортировка на месте перетасовала бы
	 * порядок добавления в localStorage, а он там осмысленный.
	 */
	const entries = $derived([...lists[kind]].sort((a, b) => b.addedAt - a.addedAt));

	/**
	 * Подтверждение очистки — inline, в две ступени. window.confirm выпадает из
	 * оформления, блокирует поток и на мобильном выглядит как ошибка браузера, а
	 * действие необратимо: восстановить список неоткуда.
	 */
	let confirming = $state(false);

	// Переключили вкладку — снимаем взведённое подтверждение, иначе оно повисает
	// над чужим списком.
	$effect(() => {
		kind;
		confirming = false;
	});

	const ICONS = { later: 'bookmark', favorite: 'heart' } as const;

	const addedFmt = new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	/** Русские числительные: «1 тайтл», «2 тайтла», «5 тайтлов». */
	function plural(n: number, one: string, few: string, many: string): string {
		const d10 = n % 10;
		const d100 = n % 100;
		if (d10 === 1 && d100 !== 11) return one;
		if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
		return many;
	}

	/** Число плиток-заглушек. Ровно на один экран сетки, дальше смысла нет. */
	const PLACEHOLDERS = Array.from({ length: 12 }, (_, i) => i);
</script>

<svelte:head>
	<title>{LIST_LABELS[kind]} — КИНЕМА</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-8 md:py-11">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative">
		<header class="mb-6">
			<p class="eyebrow mb-3">Моё</p>

			<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
				<div class="min-w-0">
					<h1 class="display-lg text-3xl text-ink md:text-[2.75rem]">{LIST_LABELS[kind]}</h1>
					<p class="mt-2 text-[13px] text-dim">
						{#if !mounted}
							Читаем список из браузера…
						{:else if entries.length}
							<span class="tnum text-ink">{entries.length}</span>
							{plural(entries.length, 'тайтл', 'тайтла', 'тайтлов')} · хранится только в этом
							браузере
						{:else}
							Пока пусто
						{/if}
					</p>
				</div>

				{#if mounted && entries.length}
					{#if confirming}
						<div class="flex flex-wrap items-center gap-2" role="status">
							<span class="text-[13px] text-dim">Точно очистить?</span>
							<button
								type="button"
								onclick={() => {
									lists.clear(kind);
									confirming = false;
								}}
								class="inline-flex h-9 items-center rounded-full border border-bad/45 bg-bad/12
								       px-4 text-xs font-semibold text-bad transition hover:bg-bad/20"
							>
								Да, очистить
							</button>
							<button
								type="button"
								onclick={() => (confirming = false)}
								class="inline-flex h-9 items-center rounded-full border border-line px-4 text-xs
								       text-dim transition hover:border-line-strong hover:text-ink"
							>
								Отмена
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (confirming = true)}
							class="inline-flex h-9 items-center gap-2 rounded-full border border-line px-4
							       text-xs text-dim transition hover:border-line-strong hover:text-ink"
						>
							<Icon name="close" size={13} />
							Очистить список
						</button>
					{/if}
				{/if}
			</div>
		</header>

		<!-- Вкладки. Счётчик появляется только после гидрации: до неё он честно
		     равен нулю и мигал бы на каждой загрузке. -->
		<nav class="mb-8 flex flex-wrap gap-2" aria-label="Личные списки">
			{#each LIST_KINDS as k (k)}
				{@const active = k === kind}
				<a
					href="/lists?kind={k}"
					aria-current={active ? 'page' : undefined}
					class="inline-flex h-10 items-center gap-2 rounded-full border px-5 text-[13px] transition
					       {active
						? 'border-accent bg-accent font-semibold text-accent-ink'
						: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
					style={active ? 'box-shadow: var(--glow-sm)' : ''}
				>
					<Icon name={ICONS[k]} size={15} />
					{LIST_LABELS[k]}
					{#if mounted && lists.count(k) > 0}
						<span class="tnum {active ? 'opacity-65' : 'text-faint'}">{lists.count(k)}</span>
					{/if}
				</a>
			{/each}
		</nav>

		{#if !mounted}
			<div class="poster-grid" aria-hidden="true">
				{#each PLACEHOLDERS as i (i)}
					<div>
						<div class="skeleton aspect-[2/3] rounded-md"></div>
						<div class="skeleton mt-2.5 h-3 w-3/4 rounded-xs"></div>
					</div>
				{/each}
			</div>
		{:else if entries.length}
			<div class="poster-grid">
				{#each entries as entry (entry.type + entry.tmdbId)}
					<div class="group relative">
						<MediaCard item={entryToItem(entry)} width="100%" bare />

						<!-- Кнопка удаления соседствует с карточкой, а не живёт внутри неё:
						     MediaCard в режиме bare сознательно без действий, а вкладывать
						     кнопку в ссылку-обёртку нельзя. -->
						<button
							type="button"
							onclick={() => lists.remove(kind, entry.tmdbId, entry.type)}
							aria-label="Убрать из списка: {entry.title}"
							title="Убрать из списка"
							class="absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-full
							       border border-line bg-canvas/75 text-dim backdrop-blur-md transition
							       hover:border-line-strong hover:bg-canvas hover:text-ink md:opacity-0
							       md:group-hover:opacity-100 md:focus-visible:opacity-100"
						>
							<Icon name="close" size={13} />
						</button>

						<p class="mt-1 text-[10.5px] leading-none text-faint">
							добавлено {addedFmt.format(entry.addedAt)}
						</p>
					</div>
				{/each}
			</div>
		{:else}
			<!-- Пустое состояние объясняет главное недоразумение этой страницы: список
			     не «потерялся», он просто никогда не покидал этот браузер. -->
			<div
				class="rounded-lg border border-line-soft bg-surface/40 px-6 py-16 text-center md:py-20"
			>
				<span
					class="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-line
					       bg-canvas/60 text-faint"
					aria-hidden="true"
				>
					<Icon name={ICONS[kind]} size={24} />
				</span>

				<p class="mb-2.5 text-[15px] text-ink">
					{kind === 'later' ? 'В «Смотреть позже» пока пусто' : 'В избранном пока пусто'}
				</p>

				<p class="mx-auto mb-3 max-w-xl text-[13px] leading-relaxed text-dim">
					Добавляйте тайтлы кнопкой
					<span class="text-ink">
						{kind === 'later' ? '«Смотреть позже»' : '«В избранное»'}
					</span>
					на карточке — она появляется при наведении на постер.
				</p>

				<p class="mx-auto mb-7 max-w-xl text-[12px] leading-relaxed text-faint">
					Список хранится в этом браузере и никуда не отправляется: вход не нужен, но и
					синхронизации нет. На телефоне будет свой список, а очистка данных сайта сотрёт
					оба.
				</p>

				<div class="flex flex-wrap justify-center gap-2.5">
					<a
						href="/catalog/movies"
						class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
						       font-semibold text-accent-ink transition hover:bg-accent-hover"
						style="box-shadow: var(--glow-sm)"
					>
						<Icon name="film" size={16} />
						Открыть каталог
					</a>
					<a
						href="/picker"
						class="inline-flex h-11 items-center gap-2 rounded-full border border-line
						       bg-surface/60 px-6 text-sm text-ink transition hover:border-line-strong
						       hover:bg-surface-2"
					>
						<Icon name="dice" size={16} />
						Подобрать фильм
					</a>
				</div>
			</div>
		{/if}
	</div>
</main>
