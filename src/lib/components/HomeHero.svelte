<script lang="ts">
	/**
	 * Герой главной.
	 *
	 * Прошлая версия была кроссфейдом кадров: картинка сменялась прозрачностью,
	 * снизу справа стояли три полоски-индикатора, и всё. Претензия к ней была
	 * справедливой — это слайдер, а не витрина. Что изменено по существу:
	 *
	 * — КАДР ЖИВЁТ. Медленный наезд (эффект Кена Бёрнса) на активном слайде. Без
	 *   движения статичный кадр за девять секунд превращается в обои, и глаз
	 *   перестаёт его замечать.
	 *
	 * — СМЕНА СО СДВИГОМ. Уходящий слайд не просто гаснет, а немного уезжает.
	 *   Чистая прозрачность читается как подмена картинки; сдвиг читается как
	 *   переход к следующему тайтлу.
	 *
	 * — ЛЕНТА МИНИАТЮР вместо полосок. Полоска сообщает только «здесь ещё три
	 *   слайда». Миниатюра показывает, что именно будет дальше, и по ней можно
	 *   попасть сразу в нужный тайтл. На активной миниатюре идёт полоса
	 *   автолистания — момент смены кадра перестаёт быть внезапным.
	 *
	 * — ФАКТЫ ИКОНКАМИ. Раньше здесь были тип, год и рейтинг. Теперь ещё жанры
	 *   (с их иконками), длительность и возраст, когда TMDB их отдаёт. Это то,
	 *   по чему решают «смотреть или листать дальше».
	 *
	 * — УПРАВЛЕНИЕ. Стрелки на десктопе, свайп на телефоне, пауза при наведении и
	 *   пауза, когда вкладка ушла в фон: крутить слайды в невидимой вкладке —
	 *   значит зря жечь батарею и трафик на кадрах, которых никто не видит.
	 *
	 * Логотип тайтла (прозрачный PNG с оригинальной типографикой названия) —
	 * прежнее решение и оно остаётся: именно оно отличает витрину стриминга от
	 * «картинки с подписью». Текстовый заголовок — полноценный фолбэк, а не
	 * аварийный вариант: логотип есть далеко не у всех.
	 */

	import { lists } from '$lib/lists.svelte';
	import { logoOf, requestLogo } from '$lib/logos.svelte';
	import { toSlug } from '$lib/slug';
	import type { CatalogItem } from '$lib/types';
	import GenreIcon from './ui/GenreIcon.svelte';
	import Icon from './ui/Icon.svelte';
	import RatingArc from './ui/RatingArc.svelte';

	interface Props {
		slides: CatalogItem[];
		/** Нечего играть вообще — влияет на подпись недоступной кнопки. */
		noPlaybackSource?: boolean;
	}

	let { slides, noPlaybackSource = false }: Props = $props();

	/**
	 * Сколько держится один слайд. Тем же числом идёт полоса заполнения палочки.
	 *
	 * Шесть секунд вместо девяти: девять читались как «зависло». Меньше делать
	 * нельзя — за четыре секунды не успеть прочитать описание в три строки, и
	 * витрина начинает дёргаться.
	 */
	const SLIDE_MS = 6000;

	let index = $state(0);
	let hidden = $state(false);
	/**
	 * Счётчик циклов. Нужен только для перезапуска CSS-анимации прогресса:
	 * анимация начинается заново, когда элемент пересоздаётся по ключу.
	 */
	let cycle = $state(0);

	const hero = $derived(slides[index]);

	const href = $derived(
		hero ? `/${hero.type === 'movie' ? 'movie' : 'show'}/${toSlug(hero.tmdbId, hero.title)}` : '/'
	);

	const logo = $derived(hero ? (hero.logo ?? logoOf(hero.type, hero.tmdbId)) : null);
	const inLater = $derived(hero ? lists.has('later', hero.tmdbId, hero.type) : false);

	const runtime = $derived.by(() => {
		const m = hero?.runtimeMin;
		if (!m) return null;
		if (m < 60) return `${m} мин`;
		const h = Math.floor(m / 60);
		const rest = m % 60;
		return rest ? `${h} ч ${rest} мин` : `${h} ч`;
	});

	/**
	 * Логотипы остальных слайдов просим батчем на клиенте: с сервера приходит
	 * только первый, чтобы первый байт главной не ждал шести запросов к TMDB.
	 */
	$effect(() => {
		for (const s of slides) requestLogo(s.type, s.tmdbId);
	});

	function go(next: number) {
		if (!slides.length) return;
		index = (next + slides.length) % slides.length;
		cycle += 1;
	}

	/**
	 * Автолистание.
	 *
	 * Паузы при наведении больше нет — по требованию. У неё была причина: слайд
	 * мог смениться в момент, когда человек тянется к кнопке «Смотреть», и кнопка
	 * уезжала из-под курсора. Сейчас это терпимо: шесть секунд достаточно, чтобы
	 * такое случалось редко, а палочка показывает, сколько осталось до смены.
	 * Если снова начнёт мешать, паузу стоит вернуть только для области кнопок, а
	 * не для всего героя.
	 */
	$effect(() => {
		if (hidden || slides.length < 2) return;
		const id = setInterval(() => go(index + 1), SLIDE_MS);
		return () => clearInterval(id);
	});

	// Вкладка в фоне: слайды не листаем. Кадры весят по несколько сотен килобайт,
	// и подгружать их для невидимой страницы бессмысленно.
	$effect(() => {
		const sync = () => (hidden = document.hidden);
		sync();
		document.addEventListener('visibilitychange', sync);
		return () => document.removeEventListener('visibilitychange', sync);
	});

	/* --------------------------------- свайп --------------------------------- */

	let touchX = 0;
	let touchY = 0;

	function onTouchStart(e: TouchEvent) {
		touchX = e.touches[0]?.clientX ?? 0;
		touchY = e.touches[0]?.clientY ?? 0;
	}

	function onTouchEnd(e: TouchEvent) {
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
		const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY;
		// Горизонтальное движение должно явно преобладать: иначе обычная прокрутка
		// страницы пальцем начнёт случайно перелистывать слайды.
		if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
	}
</script>

{#if hero}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<section
		class="group/hero relative h-[calc(100dvh-var(--header-h)-var(--tabbar-h)-var(--notice-h,0px))]
		       min-h-[480px] w-full overflow-hidden"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
		aria-roledescription="карусель"
		aria-label="Рекомендуем"
	>
		{#each slides as slide, i (slide.tmdbId)}
			{@const active = i === index}
			<div
				class="absolute inset-0 transition-all duration-[1200ms] ease-[var(--ease-out-quint)]"
				style="opacity: {active ? 1 : 0}; transform: translateX({active
					? '0'
					: i < index
						? '-2.5%'
						: '2.5%'})"
				aria-hidden={!active}
			>
				{#if slide.backdrop}
					<img
						src={slide.backdrop}
						alt=""
						class="h-full w-full object-cover object-top {active ? 'hero-zoom' : ''}"
						fetchpriority={i === 0 ? 'high' : 'low'}
						loading={i === 0 ? 'eager' : 'lazy'}
					/>
				{:else}
					<div class="h-full w-full bg-surface"></div>
				{/if}
			</div>
		{/each}

		<!--
			Три градиента, а не один. Снизу — под подпись и стык с рядами; слева —
			под колонку с текстом; сверху — чтобы «стеклянная» шапка не висела на
			светлом кадре. Одного диагонального не хватает: на кадрах со светлым
			левым краем текст становится нечитаемым.
		-->
		<div class="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/35 to-transparent"></div>
		<div
			class="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/55 to-transparent
			       md:via-canvas/35"
		></div>
		<div class="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-canvas/85 to-transparent"></div>

		<div
			class="relative mx-auto flex h-full max-w-[var(--page-max)] items-end
			       px-[var(--gutter)] pb-16 md:pb-24"
		>
			<div class="max-w-2xl">
				{#key hero.tmdbId}
					<!-- Ключ по тайтлу: содержимое колонки должно появляться заново на
					     каждом слайде, иначе текст подменяется на месте и смена слайда
					     выглядит как опечатка, а не как переход. -->
					<div class="hero-in">
						{#if logo}
							<!-- max-h вместо фиксированной высоты: логотипы приходят и
							     вытянутыми в ширину, и почти квадратными. -->
							<img
								src={logo}
								alt={hero.title}
								class="mb-4 max-h-20 w-auto max-w-[min(28rem,88%)] object-contain object-left
								       drop-shadow-[0_8px_28px_rgba(0,0,0,0.75)] sm:max-h-24 md:max-h-32
								       tv:max-h-44"
							/>
						{:else}
							<h1 class="display-xl mb-4 text-[2rem] text-ink sm:text-4xl md:text-6xl tv:text-7xl">
								{hero.title}
							</h1>
						{/if}

						<!--
							ОДНА строка мета вместо трёх групп.

							Было: сверху «ФИЛЬМ 2026», под названием отдельно дуга рейтинга, и
							рядом с ней жанры. Три разрозненные кучки вокруг заголовка, причём
							тип и год стояли ВЫШЕ названия, хотя это самое неважное на экране.

							Стало: под названием одна строка в порядке важности — рейтинг,
							тип, год, длительность, возраст, жанры. Разделители точками, всё
							одним кеглем; рейтинг числом с дугой, потому что он единственный
							требует сравнения, а не чтения.
						-->
						<div class="mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12.5px]
						            text-white/85 tv:gap-x-4 tv:text-lg">
							{#if hero.rating}
								<span class="mr-0.5 inline-flex items-center gap-2">
									<RatingArc value={hero.rating} votes={hero.votes} size={34} />
								</span>
							{/if}

							<span class="font-medium">{hero.type === 'movie' ? 'Фильм' : 'Сериал'}</span>

							{#if hero.year}
								<span class="text-white/35" aria-hidden="true">·</span>
								<span class="tnum">{hero.year}</span>
							{/if}

							{#if runtime}
								<span class="text-white/35" aria-hidden="true">·</span>
								<span>{runtime}</span>
							{/if}

							{#if hero.ageRating}
								<span
									class="tnum rounded border border-white/30 px-1.5 text-[11px] text-white/85"
									title="Возрастной рейтинг"
								>
									{hero.ageRating}
								</span>
							{/if}

							{#if hero.genres?.length}
								<span class="text-white/35" aria-hidden="true">·</span>
								{#each hero.genres.slice(0, 3) as name, gi (name)}
									{@const id = hero.genreIds?.[gi]}
									<span class="inline-flex items-center gap-1.5">
										<!-- Иконку ставим только когда жанр известен по номеру: иначе у всех
										     оказалась бы одна заглушка-плёнка, и графика переставала бы
										     различать жанры — то есть мешала бы. -->
										{#if id}<GenreIcon {id} size={14} />{/if}
										{name}
									</span>
								{/each}
							{/if}
						</div>

						{#if hero.overview}
							<p
								class="mb-7 line-clamp-3 max-w-xl text-[13px] leading-relaxed text-white/75
								       sm:text-sm md:text-[15px] tv:text-xl"
							>
								{hero.overview}
							</p>
						{/if}
					</div>
				{/key}

				<div class="flex flex-wrap items-center gap-2.5">
					{#if hero.inLibrary}
						<a
							href="{href}/watch"
							class="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-6 text-sm
							       font-semibold text-accent-ink transition duration-[var(--t-fast)]
							       hover:bg-accent-hover sm:px-7 tv:h-16 tv:px-10 tv:text-lg"
							style="box-shadow: var(--glow-md)"
						>
							<Icon name="play" size={16} />
							Смотреть
						</a>
					{:else}
						<!-- Причина, а не констатация: см. TitlePage. -->
						<span
							class="inline-flex h-12 cursor-not-allowed items-center gap-2.5 rounded-full
							       border border-line px-7 text-sm font-medium text-faint"
							title={noPlaybackSource
								? 'Источник воспроизведения не подключён — укажите JELLYFIN_URL'
								: 'Тайтла нет в подключённой медиатеке'}
						>
							{noPlaybackSource ? 'Источник не подключён' : 'Нет в медиатеке'}
						</span>
					{/if}

					<a
						{href}
						class="inline-flex h-12 items-center gap-2 rounded-full border border-line
						       bg-surface/60 px-5 text-sm font-medium text-ink backdrop-blur-md transition
						       duration-[var(--t-fast)] hover:border-line-strong hover:bg-surface-2 sm:px-6
						       tv:h-16 tv:px-8 tv:text-lg"
					>
						Подробнее
					</a>

					<button
						type="button"
						onclick={() => lists.toggle('later', hero)}
						aria-pressed={inLater}
						title={inLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже'}
						class="grid h-12 w-12 place-items-center rounded-full border backdrop-blur-md
						       transition duration-[var(--t-fast)] tv:h-16 tv:w-16 {inLater
							? 'border-accent bg-accent text-accent-ink'
							: 'border-line bg-surface/60 text-ink hover:border-line-strong hover:bg-surface-2'}"
					>
						<Icon name={inLater ? 'check' : 'bookmark'} size={18} />
					</button>
				</div>
			</div>
		</div>

		{#if slides.length > 1}
			<!--
				Палочки. Одна на слайд, активная наливается акцентом за то же время, что
				держится кадр, — по ней видно, сколько осталось до смены, и переключение
				перестаёт быть внезапным.

				Заполнение рисует CSS-анимация, а переключает таймер. Чтобы они не
				разошлись, длительность у обоих одна (SLIDE_MS), а анимация
				перезапускается пересозданием элемента по ключу цикла: без этого после
				паузы полоса продолжала бы ехать с прежнего места, хотя таймер уже
				начался заново.

				Кнопки, а не индикаторы: нажатие переключает слайд вручную. Отдельных
				стрелок больше нет — они соревновались за внимание с кнопкой «Смотреть»,
				а палочки дают и позицию, и управление.
			-->
			<div
				class="absolute bottom-6 left-[var(--gutter)] flex items-center gap-2 md:bottom-8
				       md:left-auto md:right-[var(--gutter)]"
				role="tablist"
				aria-label="Слайды"
			>
				{#each slides as slide, i (slide.tmdbId)}
					{@const active = i === index}
					<button
						type="button"
						role="tab"
						onclick={() => go(i)}
						aria-selected={active}
						aria-label={slide.title}
						title={slide.title}
						class="group/dot relative h-6 overflow-hidden transition-all
						       duration-[var(--t-slow)] ease-[var(--ease-out-quint)] {active
							? 'w-16 md:w-20 tv:w-28'
							: 'w-6 md:w-8 tv:w-12'}"
					>
						<!-- Полоса тонкая, а кнопка высокая: по трёхпиксельной палочке
						     невозможно попасть пальцем, поэтому область нажатия больше
						     самой графики. -->
						<span
							class="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2
							       overflow-hidden rounded-full transition-colors duration-[var(--t-mid)]
							       {active ? 'bg-white/25' : 'bg-white/25 group-hover/dot:bg-white/45'}"
						>
							{#if active}
								{#key cycle}
									<span
										class="hero-progress block h-full rounded-full bg-accent"
										style="animation-duration: {SLIDE_MS}ms; animation-play-state: {hidden
											? 'paused'
											: 'running'}"
									></span>
								{/key}
							{/if}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</section>
{/if}
