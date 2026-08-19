<script lang="ts">
	/**
	 * Описание тайтла, разворачивающееся из обложки.
	 *
	 * Прошлая версия была отдельной панелью сбоку от карточки, и это справедливо
	 * не понравилось: наклейка рядом с постером, не связанная с ним ничем, кроме
	 * близости. Здесь связь физическая:
	 *
	 * — Панель центрируется на обложке и растёт ИЗ ЕЁ ЦЕНТРА. Точка роста
	 *   (transform-origin) вычисляется как центр обложки в координатах панели,
	 *   поэтому увеличение начинается именно оттуда, где лежал постер, а не из
	 *   абстрактного угла.
	 *
	 * — Наверху панели тот же постер. Не кадр, не другая картинка — та же самая, и
	 *   обрезана сверху (object-top), чтобы лицо и название остались на месте.
	 *   Глаз читает это как «обложка выросла», а не «появилось что-то новое».
	 *
	 * — Ширина считается от обложки, а не фиксированные 320 пикселей: в ряду
	 *   постеры уже, в сетке каталога шире, и панель должна быть пропорциональна
	 *   тому, из чего выросла.
	 *
	 * ПОЛОЖЕНИЕ НЕ ЗАВИСИТ ОТ ВЫСОТЫ. Раньше панель встраивалась по оценке высоты
	 * 380 пикселей, потом измеряла себя и пересчитывала положение — то есть
	 * прыгала на первом же кадре, и это читалось как «лагает». Теперь якорь —
	 * верхний край обложки, а измеренная высота нужна только чтобы не выпустить
	 * панель за нижний край экрана.
	 *
	 * Содержимое появляется в два приёма: то, что уже известно из списка (постер,
	 * название, год, рейтинг, описание), рисуется сразу, а жанры, возраст и
	 * длительность подставляются, когда ответит эндпоинт превью. Поэтому панель
	 * никогда не открывается пустой.
	 */

	import { lists } from '$lib/lists.svelte';
	import { preview } from '$lib/preview.svelte';
	import { progress } from '$lib/progress.svelte';
	import { toMediaSlug } from '$lib/slug';
	import GenreIcon from './ui/GenreIcon.svelte';
	import Icon from './ui/Icon.svelte';
	import RatingArc from './ui/RatingArc.svelte';

	/**
	 * Во сколько раз панель шире обложки.
	 *
	 * 1.55 — компромисс. Меньше: описание в узкой колонке рвётся на слова по
	 * два-три в строку. Больше: панель перестаёт читаться как выросшая карточка и
	 * снова превращается в отдельное окно.
	 */
	const GROW = 1.55;
	const MIN_W = 268;
	const MAX_W = 380;
	/** Отступ от края экрана. */
	const EDGE = 12;

	const item = $derived(preview.item);
	const rect = $derived(preview.rect);
	const details = $derived(preview.details);

	const href = $derived(
		item ? `/${item.type === 'movie' ? 'movie' : 'show'}/${toMediaSlug(item)}` : '/'
	);

	const watched = $derived(item ? progress.ratioOf(item.type, item.tmdbId) : undefined);
	const inLater = $derived(item ? lists.has('later', item.tmdbId, item.type) : false);
	const inFav = $derived(item ? lists.has('favorite', item.tmdbId, item.type) : false);

	const genres = $derived(details?.genres?.length ? details.genres : (item?.genres ?? []));
	const overview = $derived(item?.overview ?? details?.overview);
	const rating = $derived(item?.rating ?? details?.rating);
	const votes = $derived(item?.votes ?? details?.votes);
	const age = $derived(item?.ageRating ?? details?.ageRating);

	const runtime = $derived.by(() => {
		const m = item?.runtimeMin ?? details?.runtimeMin;
		if (!m) return null;
		if (m < 60) return `${m} мин`;
		const h = Math.floor(m / 60);
		const rest = m % 60;
		return rest ? `${h} ч ${rest} мин` : `${h} ч`;
	});

	/** Измеренная высота — только для зажима в экран, на якорь не влияет. */
	let panelH = $state(0);

	/**
	 * Корень панели отдаём в хранилище: перед закрытием оно проверяет, не внутри
	 * ли панели курсор. Без этого панель гасла сама — появившись под неподвижным
	 * курсором, она забирает наведение, и карточка сообщает «ушли».
	 */
	let root: HTMLElement | null = $state(null);

	$effect(() => {
		preview.bindPanel(root);
		return () => preview.bindPanel(null);
	});

	const geom = $derived.by(() => {
		if (!rect) return null;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, rect.width * GROW)));

		// По горизонтали центрируем на обложке и зажимаем в экран: у крайних
		// карточек ряда панель иначе уезжает за край.
		const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), vw - width - EDGE);

		// Верх панели чуть выше обложки: панель растёт вокруг неё, а не только вниз.
		const wanted = rect.top - 12;
		const h = panelH || 420;
		const top = Math.min(Math.max(EDGE, wanted), Math.max(EDGE, vh - h - EDGE));

		// Точка роста — центр обложки в координатах панели. Именно она делает
		// увеличение «выходящим из постера», а не из угла панели.
		const originX = Math.round(rect.left + rect.width / 2 - left);
		const originY = Math.round(rect.top + rect.height / 2 - top);

		return { left, top, width, originX, originY };
	});

	/**
	 * Панель ЕДЕТ вместе с обложкой при прокрутке, а не закрывается.
	 *
	 * Раньше здесь стояло закрытие на любое событие прокрутки — и это была
	 * настоящая причина жалобы «панель иногда не появляется». События прокрутки
	 * приходят не только когда человек крутит колесо: браузер восстанавливает
	 * позицию после загрузки страницы, ленивые картинки досчитывают вёрстку,
	 * прокручивается ряд под курсором. Любое из этих событий гасило панель через
	 * миг после появления, и выглядело это как «не показывается».
	 *
	 * Пересчёт стоит один getBoundingClientRect на кадр и только пока панель
	 * открыта. Ушла обложка с экрана — панель закрывается сама (см. track).
	 */
	$effect(() => {
		if (!item) return;

		let frame = 0;
		const onScroll = () => {
			if (frame) return;
			// Один пересчёт на кадр: события прокрутки приходят десятками в секунду.
			frame = requestAnimationFrame(() => {
				frame = 0;
				preview.track();
			});
		};

		window.addEventListener('scroll', onScroll, { passive: true, capture: true });
		window.addEventListener('resize', onScroll);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll, { capture: true });
			window.removeEventListener('resize', onScroll);
		};
	});
</script>

{#if item && geom}
	<!--
		svelte-ignore a11y_no_static_element_interactions: обработчики нужны только
		чтобы панель не закрывалась, пока курсор внутри — иначе до кнопок не
		дотянуться.
	-->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={root}
		bind:clientHeight={panelH}
		class="preview-grow fixed z-[130] overflow-hidden rounded-lg bg-elev shadow-4
		       ring-1 ring-accent/25"
		style="left: {geom.left}px; top: {geom.top}px; width: {geom.width}px;
		       transform-origin: {geom.originX}px {geom.originY}px"
		onmouseenter={() => preview.keep()}
		onmouseleave={() => preview.leave()}
		role="tooltip"
	>
		<!--
			Обложка. Та же картинка, что на карточке, обрезанная сверху: у постеров
			значимое (лицо, название) сверху, и обрезать надо низ. Соотношение 4:5
			вместо полного 2:3 — иначе панель становится вдвое выше экрана.
		-->
		<a {href} class="block" tabindex="-1" aria-hidden="true">
			<div class="relative aspect-[4/5] w-full overflow-hidden bg-surface">
				{#if item.poster || item.backdrop}
					<img
						src={item.poster ?? item.backdrop}
						alt=""
						class="h-full w-full object-cover object-top"
					/>
				{/if}

				<!-- Затемнение к низу: под ним лежит название, и оно должно читаться на
				     любом постере. -->
				<div class="absolute inset-0 bg-gradient-to-t from-elev via-elev/25 to-transparent"></div>

				<!-- Название на обложке, а не под ней: так верх панели остаётся
				     картинкой, а не превращается в шапку с текстом. -->
				<div class="absolute inset-x-0 bottom-0 p-3">
					<p class="line-clamp-2 text-[15px] font-semibold leading-tight text-white tv:text-xl">
						{item.title}
					</p>
				</div>

				{#if watched !== undefined}
					<div class="absolute inset-x-0 bottom-0 h-[3px] bg-black/55">
						<div class="h-full bg-accent" style="width: {Math.max(2, watched * 100)}%"></div>
					</div>
				{/if}
			</div>
		</a>

		<div class="p-3">
			<!-- Одна строка мета: рейтинг, тип, год, длительность, возраст. Раньше
			     рейтинг стоял отдельным блоком справа и разрывал строку пополам. -->
			<div class="mb-2 flex items-center gap-2">
				{#if rating}
					<RatingArc value={rating} {votes} size={34} />
				{/if}
				<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-dim tv:text-sm">
					<span>{item.type === 'movie' ? 'Фильм' : 'Сериал'}</span>
					{#if item.year}
						<span aria-hidden="true">·</span><span class="tnum">{item.year}</span>
					{/if}
					{#if runtime}
						<span aria-hidden="true">·</span><span>{runtime}</span>
					{/if}
					{#if age}
						<span
							class="tnum ml-0.5 rounded border border-line-strong px-1 leading-[1.4]"
							title="Возрастной рейтинг"
						>
							{age}
						</span>
					{/if}
				</div>
			</div>

			{#if genres.length}
				<!-- Жанры текстом с иконками, без рамок и подложек: в панели такого
				     размера три обведённых чипса перетягивают внимание с описания. -->
				<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
					{#each genres.slice(0, 3) as name, i (name)}
						{@const id = item.genreIds?.[i]}
						<span class="inline-flex items-center gap-1">
							{#if id}<GenreIcon {id} size={12} />{/if}
							{name}
						</span>
					{/each}
				</div>
			{:else if preview.loading}
				<div class="mb-2 flex gap-2" aria-hidden="true">
					<span class="skeleton h-3 w-14 rounded-full"></span>
					<span class="skeleton h-3 w-16 rounded-full"></span>
				</div>
			{/if}

			{#if overview}
				<p class="mb-3 line-clamp-3 text-[11.5px] leading-relaxed text-dim tv:text-base">
					{overview}
				</p>
			{/if}

			<div class="flex items-center gap-1.5">
				{#if item.inLibrary}
					<a
						href="{href}/watch"
						class="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full
						       bg-accent text-[12.5px] font-semibold text-accent-ink transition
						       duration-[var(--t-fast)] hover:bg-accent-hover tv:h-12 tv:text-base"
					>
						<Icon name="play" size={13} />
						{watched !== undefined ? 'Продолжить' : 'Смотреть'}
					</a>
				{:else}
					<a
						{href}
						class="inline-flex h-9 flex-1 items-center justify-center rounded-full border
						       border-line text-[12.5px] font-medium text-dim transition duration-[var(--t-fast)]
						       hover:border-line-strong hover:text-ink tv:h-12 tv:text-base"
					>
						Подробнее
					</a>
				{/if}

				<button
					type="button"
					onclick={() => lists.toggle('later', item)}
					aria-pressed={inLater}
					aria-label={inLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже'}
					class="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition
					       duration-[var(--t-fast)] tv:h-12 tv:w-12 {inLater
						? 'border-accent bg-accent text-accent-ink'
						: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
				>
					<Icon name={inLater ? 'check' : 'bookmark'} size={14} />
				</button>
				<button
					type="button"
					onclick={() => lists.toggle('favorite', item)}
					aria-pressed={inFav}
					aria-label={inFav ? 'Убрать из избранного' : 'В избранное'}
					class="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition
					       duration-[var(--t-fast)] tv:h-12 tv:w-12 {inFav
						? 'border-accent bg-accent text-accent-ink'
						: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
				>
					<Icon name="heart" size={14} filled={inFav} />
				</button>
			</div>
		</div>
	</div>
{/if}
