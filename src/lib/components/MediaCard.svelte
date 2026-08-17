<script lang="ts">
	/**
	 * Карточка тайтла.
	 *
	 * Ключевые решения:
	 *
	 * — Разметка построена на «растянутой ссылке»: постер и подпись лежат обычными
	 *   блоками, а ссылка — прозрачный слой поверх них. Так кнопки действий больше
	 *   не вложены внутрь <a> (интерактивное внутри интерактивного — невалидная
	 *   разметка, из-за которой скринридеры и Safari ведут себя непредсказуемо), и
	 *   при этом клик по любому месту карточки по-прежнему открывает тайтл.
	 *
	 * — Кнопка воспроизведения живёт в кружке рейтинга: в покое там дуга с оценкой,
	 *   при наведении та же окружность заливается белым и внутри появляется
	 *   треугольник. До этого рейтинг гас, а кнопка возникала в центре постера —
	 *   информация исчезала в одном месте, действие появлялось в другом, и глаз
	 *   каждый раз перескакивал. Один элемент на два состояния решает и это, и
	 *   прежнюю проблему бейджа в углу, который висел постоянно и утверждал
	 *   очевидное («это можно смотреть») у почти каждой карточки в сетке.
	 *
	 * — Полоса прогресса под постером видна всегда, без наведения: это единственный
	 *   факт о карточке, которого нет больше нигде, и прятать его в hover-состояние
	 *   значит прятать от тач-устройств полностью.
	 *
	 * — Карточка при наведении не сдвигается. Подъём срезался контейнером
	 *   горизонтальной прокрутки: overflow-x: auto обрезает и по вертикали. Отклик
	 *   даёт постер, который приближается внутри своей рамки, — за её границы он
	 *   выйти не может.
	 *
	 * — Под постером текстовое название, а не логотип: в сетке из сорока карточек
	 *   графика названий превращается в мозаику начертаний. Логотип работает в
	 *   герое главной, где он один и крупный.
	 *
	 * — Номер в нумерованном ряду вынесен в отдельную колонку фиксированной
	 *   ширины. Раньше он лежал поверх постера обводкой, и у «1» и «10» ширина
	 *   отличалась, из-за чего постеры в ряду стояли неровно.
	 */

	import { toSlug } from '$lib/slug';
	import { lists } from '$lib/lists.svelte';
	import { preview } from '$lib/preview.svelte';
	import { progress } from '$lib/progress.svelte';
	import type { CatalogItem } from '$lib/types';
	import Icon from './ui/Icon.svelte';
	import RatingArc from './ui/RatingArc.svelte';

	interface Props {
		item: CatalogItem;
		/** Ширина в ряду. В сетке передаётся 100%. */
		width?: string;
		/** Номер в нумерованном ряду (топ-10). */
		rank?: number;
		/** Не показывать кнопки списков — например, на самой странице списков. */
		bare?: boolean;
		/** Приоритетная загрузка: только для первых карточек первого экрана. */
		eager?: boolean;
		/** Подпись вместо года и жанра — для ряда «продолжить просмотр». */
		caption?: string;
		/** Готовая ссылка на продолжение: карточка ведёт сразу на нужную секунду. */
		resumeHref?: string;
	}

	let {
		item,
		width = '11rem',
		rank,
		bare = false,
		eager = false,
		caption,
		resumeHref
	}: Props = $props();

	const href = $derived(
		`/${item.type === 'movie' ? 'movie' : 'show'}/${toSlug(item.tmdbId, item.title)}`
	);
	const playHref = $derived(resumeHref ?? `${href}/watch`);

	const inLater = $derived(lists.has('later', item.tmdbId, item.type));
	const inFav = $derived(lists.has('favorite', item.tmdbId, item.type));

	/** Доля просмотра. undefined — не начинали, полосу не рисуем. */
	const watched = $derived(progress.ratioOf(item.type, item.tmdbId));

	/**
	 * Обложка. Панель разворачивается именно из неё, поэтому координаты нужны от
	 * картинки, а не от всей карточки: иначе панель наезжала на подпись под
	 * постером и росла не из того места.
	 */
	let posterEl: HTMLElement | null = $state(null);

	/**
	 * Фокус пришёл с клавиатуры или пульта?
	 *
	 * Щелчок мышью тоже даёт фокус, и раньше из-за этого панель открывалась уже
	 * ПОСЛЕ перехода на страницу фильма. :focus-visible — ровно то различие,
	 * которое здесь нужно, и его считает сам браузер: своя реализация неизбежно
	 * разойдётся с его поведением.
	 */
	function onFocusIn(e: FocusEvent) {
		if (!posterEl) return;
		const target = e.target as HTMLElement | null;
		if (target?.matches?.(':focus-visible')) preview.enterViaFocus(item, posterEl);
	}
</script>

<!--
	Наведение открывает панель с описанием. Обработчики на корне карточки, а не на
	постере: панели нужны координаты всей карточки, включая подпись, иначе она
	наезжает на название.

	Фокус тоже открывает: с клавиатуры описание должно быть доступно так же, как
	мышью. focusin, а не focus — событие должно долетать от вложенных ссылок.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group/card relative flex"
	style="width: {width}"
	onmouseenter={(e) => posterEl && preview.arm(item, posterEl, e)}
	onmousemove={(e) => posterEl && preview.arm(item, posterEl, e)}
	onmouseleave={() => preview.leave()}
	onfocusin={onFocusIn}
>
	{#if rank}
		<span
			class="tnum pointer-events-none flex shrink-0 select-none items-start justify-end pr-1.5
			       pt-0.5 font-display text-[2.25rem] font-bold leading-[0.85] text-line-strong
			       transition-colors duration-[var(--t-mid)] group-hover/card:text-dim md:text-[3rem]
			       tv:text-[4rem]"
			style="width: var(--rank-w)"
			aria-hidden="true"
		>
			{rank}
		</span>
	{/if}

	<!-- relative: якорь для растянутой ссылки, которая покрывает постер и подпись -->
	<div class="relative min-w-0 flex-1">
		<div
			bind:this={posterEl}
			class="lift relative aspect-[2/3] overflow-hidden rounded-md bg-surface ring-1 ring-line-soft
			       transition duration-[var(--t-slow)] ease-[var(--ease-out-quint)]
			       group-hover/card:shadow-3 group-hover/card:ring-2 group-hover/card:ring-accent/45"
			data-in-library={item.inLibrary}
		>
			{#if item.poster}
				<img
					src={item.poster}
					alt=""
					loading={eager ? 'eager' : 'lazy'}
					fetchpriority={eager ? 'high' : 'auto'}
					decoding="async"
					class="h-full w-full object-cover transition-transform duration-[var(--t-slower)]
					       ease-[var(--ease-out-quint)] group-hover/card:scale-[1.07]"
				/>
			{:else}
				<!-- Постера нет: не пустой прямоугольник, а название крупно. -->
				<div
					class="flex h-full items-center justify-center bg-gradient-to-br from-surface-2
					       to-surface p-3 text-center font-display text-sm leading-tight text-faint"
				>
					{item.title}
				</div>
			{/if}

			<!-- Градиент проявляется только при наведении: постоянное затемнение
			     съедает нижнюю треть постера во всей сетке. -->
			<div
				class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/30
				       to-transparent opacity-0 transition-opacity duration-[var(--t-mid)]
				       group-hover/card:opacity-100 group-focus-within/card:opacity-100"
			></div>

			<!--
				Один кружок в левом верхнем углу на два состояния.

				Раньше при наведении рейтинг просто гас, а кнопка воспроизведения
				появлялась в центре постера: информация исчезала в одном месте, а
				действие возникало в другом, и глаз каждый раз перескакивал. Теперь это
				один элемент: в покое — дуга с оценкой, при наведении та же окружность
				заливается белым и внутри появляется треугольник.

				Кнопка — ссылка, а не button: она ведёт в плеер, значит должна
				открываться средним щелчком и «в новой вкладке», как любая ссылка. z-20
				держит её выше растянутого слоя ссылки на страницу тайтла, иначе клик
				уходил бы не в плеер.

				Размер фиксирован (40px) и одинаков у обоих состояний — иначе на
				переходе кружок дёргается.
			-->
			{#if item.rating && item.rating > 0 || item.inLibrary}
				<div class="absolute left-2 top-2 z-20 h-10 w-10 tv:h-14 tv:w-14">
					{#if item.rating && item.rating > 0}
						<div
							class="pointer-events-none absolute inset-0 transition-opacity duration-[var(--t-mid)]
							       {item.inLibrary
								? 'group-hover/card:opacity-0 group-focus-within/card:opacity-0'
								: ''}"
						>
							<RatingArc value={item.rating} votes={item.votes} size={40} />
						</div>
					{/if}

					{#if item.inLibrary}
						<a
							href={playHref}
							aria-label={`${watched !== undefined ? 'Продолжить' : 'Смотреть'}: ${item.title}`}
							class="absolute inset-0 grid scale-90 place-items-center rounded-full bg-white
							       text-accent-ink opacity-0 shadow-2 transition-all duration-[var(--t-mid)]
							       ease-[var(--ease-spring)] group-hover/card:scale-100
							       group-hover/card:opacity-100 focus-visible:scale-100 focus-visible:opacity-100
							       hover:bg-accent-hover"
						>
							<!-- Треугольник оптически смещён вправо: у play-иконок центр масс
							     левее геометрического, иначе он кажется съехавшим. -->
							<span class="ml-0.5"><Icon name="play" size={15} /></span>
						</a>
					{/if}
				</div>
			{/if}

			<!--
				Отметки списков. Иконки, а не кнопки: нажимать их теперь во всплывающей
				панели, а здесь они только сообщают, что тайтл уже отложен или в
				избранном. Видны всегда — на тач-устройствах панели нет вообще, и
				иначе о состоянии списков там узнать было бы негде.
			-->
			{#if !bare && (inLater || inFav)}
				<div class="pointer-events-none absolute right-2 top-2 z-20 flex gap-1">
					{#if inLater}
						<span
							class="grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink
							       shadow-2"
							>
							<Icon name="bookmark" size={12} />
						</span>
					{/if}
					{#if inFav}
						<span
							class="grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink
							       shadow-2"
						>
							<Icon name="heart" size={12} filled />
						</span>
					{/if}
				</div>
			{/if}

			<!--
				Полоса прогресса. Прижата к нижнему краю постера и видна всегда: это
				единственный факт, которого больше нигде нет. Подложка тёмная, а не
				прозрачная, иначе на светлом постере остатка не видно.
			-->
			{#if watched !== undefined}
				<div
					class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[3px] bg-black/55"
					role="progressbar"
					aria-valuenow={Math.round(watched * 100)}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label="Просмотрено"
				>
					<div
						class="h-full bg-accent transition-[width] duration-[var(--t-slow)]"
						style="width: {Math.max(2, watched * 100)}%"
					></div>
				</div>
			{/if}
		</div>

		<!--
			Подпись. Здесь именно текстовое название: логотипы отсюда убраны
			осознанно — в сетке из сорока карточек графика названий превращается
			в мозаику разных начертаний, а год и жанр перестают читаться.
			Логотип теперь работает там, где ему и место — в герое главной.
		-->
		<div class="mt-2.5">
			<div
				class="truncate text-[13px] font-medium leading-snug text-ink transition-colors
				       duration-[var(--t-mid)] group-hover/card:text-accent tv:text-lg"
			>
				{item.title}
			</div>

			<div class="mt-1 flex items-center gap-1.5 text-[11px] text-faint tv:text-sm">
				{#if caption}
					<span class="truncate">{caption}</span>
				{:else}
					{#if item.year}<span class="tnum">{item.year}</span>{/if}
					{#if item.year && item.genres?.length}<span aria-hidden="true">·</span>{/if}
					{#if item.genres?.length}<span class="truncate">{item.genres[0]}</span>{/if}
				{/if}
			</div>
		</div>

		<!--
			Растянутая ссылка. Лежит поверх постера и подписи, но ниже кнопок (z-20),
			поэтому клик по любому «пустому» месту карточки открывает тайтл, а по
			кнопкам — работает кнопка. Название внутри, а не в aria-label: ссылка без
			текстового содержимого хуже поддерживается голосовым управлением.
		-->
		<!--
			Растянутая ссылка без атрибута title: браузер показывал по нему нативную
			подсказку у курсора, и она висела поверх постера, мешая рассматривать
			именно то, на что человек смотрит. Название доступно скринридерам
			текстом внутри ссылки, а глазами его видно в подписи под карточкой.
		-->
		<a {href} class="absolute inset-0 z-10 rounded-md">
			<span class="sr-only">{item.title}</span>
		</a>
	</div>
</div>
