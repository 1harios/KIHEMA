<script lang="ts">
	/**
	 * Страница тайтла.
	 *
	 * Раньше здесь было: кадр, постер, описание, кнопка, актёры, похожее. Всё, что
	 * TMDB отдаёт сверх этого, не показывалось, хотя приезжало в том же ответе.
	 * Добавлено то, из-за чего человек обычно уходит на другой сайт:
	 *
	 * — Где смотреть легально (JustWatch через TMDB). Требует атрибуции — она в подвале.
	 * — Возрастной рейтинг региона (release_dates / content_ratings).
	 * — Раздельные даты: в кино и в цифре.
	 * — Производственные факты: бюджет, сборы, статус, студии, сети.
	 * — Съёмочная группа по департаментам, а не только актёры.
	 * — Галерея кадров и постеров.
	 * — Ключевые слова как навигация: это лучший способ найти «такое же».
	 * — Франшиза, если тайтл в неё входит.
	 * — Отзывы.
	 *
	 * Актёры и команда стали ссылками на страницу персоны: раньше это был текст,
	 * то есть тупик в навигации.
	 */

	import { page } from '$app/state';
	import Lightbox from './Lightbox.svelte';
	import MediaRow from './MediaRow.svelte';
	import RowShell from './RowShell.svelte';
	import SeasonsBlock from './SeasonsBlock.svelte';
	import Chip from './ui/Chip.svelte';
	import Icon, { type IconName } from './ui/Icon.svelte';
	import RatingArc from './ui/RatingArc.svelte';
	import { lists } from '$lib/lists.svelte';
	import { registerKeys } from '$lib/keys.svelte';
	import { reveal } from '$lib/reveal';
	import { toSlug } from '$lib/slug';
	import type { EpisodeSummary, TitleDetails } from '$lib/types';
	import GenreIcon from './ui/GenreIcon.svelte';

	interface Props {
		title: TitleDetails;
		season: number | null;
		episodes: EpisodeSummary[];
	}

	let { title, season, episodes }: Props = $props();

	const base = $derived(
		`/${title.type === 'movie' ? 'movie' : 'show'}/${toSlug(title.tmdbId, title.title)}`
	);

	/* ------------------------------- смотреть -------------------------------- */

	/** Первая доступная серия — на неё ведёт «Смотреть» у сериала. */
	const firstPlayable = $derived(episodes.find((e) => e.inLibrary));

	const watchHref = $derived(
		title.type === 'movie'
			? `${base}/watch`
			: firstPlayable
				? `${base}/watch?s=${firstPlayable.seasonNumber}&e=${firstPlayable.episodeNumber}`
				: null
	);

	const canWatch = $derived(title.type === 'movie' ? title.inLibrary : Boolean(firstPlayable));

	/* -------------------------------- формат --------------------------------- */

	const runtimeLabel = $derived.by(() => {
		if (!title.runtimeSec) return null;
		const min = Math.round(title.runtimeSec / 60);
		if (min < 60) return `${min} мин`;
		const h = Math.floor(min / 60);
		const rest = min % 60;
		return rest ? `${h} ч ${rest} мин` : `${h} ч`;
	});

	const money = new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0,
		notation: 'compact'
	});

	const dateFmt = new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});

	/** TMDB отдаёт и «2024-05-01», и полный ISO — нормализуем оба. */
	const fmtDate = (iso?: string) => {
		if (!iso) return null;
		const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
		return Number.isNaN(t) ? null : dateFmt.format(t);
	};

	const STATUS_RU: Record<string, string> = {
		Released: 'вышел',
		'Post Production': 'постпродакшн',
		'In Production': 'в производстве',
		Planned: 'заявлен',
		Rumored: 'слухи',
		Canceled: 'отменён',
		'Returning Series': 'продолжается',
		Ended: 'завершён',
		Pilot: 'пилот'
	};

	/* --------------------------------- прочее -------------------------------- */

	const inLater = $derived(lists.has('later', title.tmdbId, title.type));
	const inFav = $derived(lists.has('favorite', title.tmdbId, title.type));

	/**
	 * Почему нельзя включить.
	 *
	 * Состояние источников лежит в данных корневого layout, поэтому читаем его
	 * оттуда: дублировать пропом через три уровня компонентов ради одной подписи
	 * не стоит.
	 */
	const noSource = $derived(Boolean((page.data as { noPlaybackSource?: boolean }).noPlaybackSource));
	const archiveCount = $derived(Number((page.data as { archiveCount?: number }).archiveCount ?? 0));

	const unavailableLabel = $derived(noSource ? 'Источник не подключён' : 'Нет в медиатеке');

	/*
		Полное объяснение теперь живёт здесь, а не в полосе под шапкой: полосу
		убрали, потому что она висела на каждой странице, хотя объяснение нужно
		один раз и ровно в тот момент, когда человек видит недоступную кнопку.
		Поэтому сюда же переехало и число играющихся фильмов из архива.
	*/
	const unavailableHint = $derived.by(() => {
		if (!noSource) return 'Этого тайтла нет в подключённой медиатеке.';
		const archive = archiveCount
			? ` Прямо сейчас играется только классика в общественном достоянии — ${archiveCount} фильмов.`
			: '';
		return `Каталог берётся из TMDB, а воспроизведение — из вашей медиатеки. Укажите JELLYFIN_URL, чтобы смотреть свою коллекцию.${archive}`;
	});

	let trailerOpen = $state(false);
	let overviewOpen = $state(false);
	let galleryTab = $state<'backdrops' | 'posters'>('backdrops');
	/** Индекс открытой в просмотрщике картинки. null — просмотрщик закрыт. */
	let shot = $state<number | null>(null);

	// Смена вкладки галереи меняет и набор картинок: индекс из прошлого набора
	// указывал бы на чужой кадр. Читаем только вкладку, поэтому цикла нет.
	$effect(() => {
		galleryTab;
		shot = null;
	});

	/** Предложения провайдеров одним списком с подписью способа. */
	const offers = $derived.by(() => {
		const p = title.providers;
		if (!p) return [];
		return [
			{ label: 'По подписке', items: p.flatrate },
			{ label: 'Бесплатно', items: p.free },
			{ label: 'С рекламой', items: p.ads },
			{ label: 'Аренда', items: p.rent },
			{ label: 'Покупка', items: p.buy }
		].filter((g) => g.items.length);
	});

	const facts = $derived.by(() => {
		const f = title.facts;
		const out: { label: string; value: string; icon: IconName }[] = [];
		if (f.status && STATUS_RU[f.status]) {
			out.push({ label: 'Статус', value: STATUS_RU[f.status], icon: 'info' });
		}
		if (f.theatricalDate) {
			const d = fmtDate(f.theatricalDate);
			if (d) out.push({ label: 'В кино', value: d, icon: 'film' });
		}
		if (f.digitalDate) {
			const d = fmtDate(f.digitalDate);
			if (d) out.push({ label: 'В цифре', value: d, icon: 'tv' });
		}
		// Страна стоит здесь, а не в короткой справке под кадром: справку убрали,
		// потому что год и длительность в ней дублировали чипсы над названием, — а
		// страна производства это ровно производственный факт.
		if (title.countries?.length) {
			out.push({ label: 'Страна', value: title.countries.slice(0, 3).join(', '), icon: 'globe' });
		}
		if (f.budget) out.push({ label: 'Бюджет', value: money.format(f.budget), icon: 'gauge' });
		if (f.revenue) out.push({ label: 'Сборы', value: money.format(f.revenue), icon: 'star' });
		// Окупаемость считаем только когда известны оба числа — иначе это выдумка.
		if (f.budget && f.revenue && f.budget > 0) {
			out.push({
				label: 'Окупаемость',
				value: `${(f.revenue / f.budget).toFixed(1)}×`,
				icon: 'shuffle'
			});
		}
		if (title.totalEpisodes) {
			out.push({ label: 'Всего серий', value: String(title.totalEpisodes), icon: 'list' });
		}
		return out;
	});


	const gallery = $derived(
		galleryTab === 'backdrops' ? title.gallery.backdrops : title.gallery.posters
	);

	/** Абсолютный URL для og:image берём из текущего запроса, а не из константы. */
	const ogImage = $derived(
		title.backdrop ? new URL(title.backdrop, page.url.origin).toString() : undefined
	);

	/**
	 * Escape для трейлера идёт через общий реестр, а не через свой обработчик
	 * окна. Иначе одно нажатие закрывало бы и трейлер, и просмотрщик галереи, и
	 * меню темы — все три слушали окно независимо.
	 */
	$effect(() => {
		if (!trailerOpen) return;
		return registerKeys({
			id: 'trailer',
			priority: 110,
			bindings: [
				{
					combos: ['Escape'],
					hint: 'Esc',
					title: 'Закрыть трейлер',
					group: 'Просмотр',
					run: () => (trailerOpen = false)
				}
			]
		});
	});
</script>

<svelte:head>
	<title>{title.title}{title.year ? ` (${title.year})` : ''} — КИНЕМА</title>
	<meta name="description" content={title.overview?.slice(0, 160) ?? ''} />
	<meta property="og:title" content={title.title} />
	<meta property="og:description" content={title.overview?.slice(0, 200) ?? ''} />
	{#if ogImage}<meta property="og:image" content={ogImage} />{/if}
</svelte:head>

<main class="pb-8">
	<!-- ================================= герой ============================== -->
	<!--
		min-h на секции, а кадр — inset-0 внутри неё. Раньше кадр имел собственную
		высоту 68vh и при коротком описании вылезал за пределы секции: абсолютно
		спозиционированный слой рисуется поверх обычного потока, поэтому градиент
		накрывал заголовок «В ролях» и оставлял мёртвую полосу.
	-->
	<!--
		Первый блок.

		Переделан из-за конкретной проблемы: длинный текст описания лежал прямо на
		кадре, набранный тем же серым (--c-text-dim), что и в остальном интерфейсе.
		На тёмном холсте этот серый даёт контраст около 7:1, а на светлом участке
		фотографии — меньше двух, то есть текст просто исчезает. Подкрутка оттенка
		такое не лечит: кадр у каждого тайтла свой, и «достаточно светлый» участок
		найдётся всегда.

		Поэтому разделено по существу: на кадре остаётся только опознавательное —
		логотип или название, рейтинг, жанры, кнопки. Всё, что нужно читать
		построчно, уехало под кадр на плотную подложку (см. блок «О чём»).

		Что осталось на кадре, набрано белым или лежит на собственной тёмной
		подложке, а сам кадр приглушён плоским слоем поверх градиентов — так
		читаемость не зависит от того, какая именно фотография попалась.
	-->
	<section class="relative min-h-[58vh] overflow-hidden md:min-h-[64vh] tv:min-h-[52vh]">
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			{#if title.backdrop}
				<img
					src={title.backdrop}
					alt=""
					class="h-full w-full object-cover object-top"
					fetchpriority="high"
				/>
			{:else}
				<div class="h-full w-full bg-surface"></div>
			{/if}

			<!-- Плоское затемнение поверх градиентов: гарантирует минимум контраста
			     даже на выбеленных кадрах, где градиента снизу недостаточно. -->
			<div class="absolute inset-0 bg-canvas/45"></div>
			<div class="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/80 to-canvas/40"></div>
			<div
				class="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/65 to-transparent
				       md:via-canvas/40"
			></div>
			<div
				class="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-canvas/90 to-transparent"
			></div>
		</div>

		<div
			class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] pb-12 pt-24 md:pt-32"
		>
			<!--
				md:items-end — колонка с рейтингом, жанрами и кнопками выравнивается по
				низу постера. Раньше обе колонки начинались от верха, и правая
				заканчивалась заметно выше постера: две несвязанные плиты вместо одного
				блока. Нижняя линия общая — блок читается целиком.
			-->
			<div class="flex flex-col gap-7 md:flex-row md:items-end md:gap-10">
				<!-- Постер -->
				<div class="w-32 shrink-0 sm:w-40 md:w-60 tv:w-80">
					<div class="overflow-hidden rounded-md shadow-4 ring-1 ring-white/10">
						{#if title.poster}
							<img src={title.poster} alt="" class="aspect-[2/3] w-full object-cover" />
						{:else}
							<div class="aspect-[2/3] w-full bg-surface"></div>
						{/if}
					</div>

					{#if title.imdbId}
						<a
							href="https://www.imdb.com/title/{title.imdbId}/"
							target="_blank"
							rel="noopener noreferrer"
							class="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-white/55
							       transition duration-[var(--t-fast)] hover:text-white"
						>
							Открыть на IMDb
							<Icon name="external" size={11} />
						</a>
					{/if}
				</div>

				<!-- Опознавательный блок -->
				<div class="min-w-0 flex-1">
					<!--
						Факты чипсами с иконками, а не серой строкой через точку. У чипса
						своя тёмная подложка, поэтому он читается на любом кадре, а иконка
						даёт различать факты не читая: часы — длительность, календарь — год.
					-->
					<div class="mb-5 flex flex-wrap items-center gap-2">
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1
							       text-[11px] font-semibold uppercase tracking-wider text-accent-ink
							       tv:px-4 tv:py-1.5 tv:text-sm"
						>
							<Icon name={title.type === 'movie' ? 'film' : 'tv'} size={12} />
							{title.type === 'movie' ? 'Фильм' : 'Сериал'}
						</span>

						<!--
							Год, длительность и возраст — просто светлый текст с иконкой. Раньше у
							каждого была своя подложка, и верхняя строка превращалась в гирлянду
							из пяти пилюль. Плотная подложка осталась только у типа тайтла: он
							акцентный и один.
						-->
						{#if title.year}
							<span
								class="inline-flex items-center gap-1.5 text-[12px] text-white/85
								       drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] tv:text-base"
							>
								<Icon name="calendar" size={13} class="opacity-70" />
								<span class="tnum">{title.year}</span>
							</span>
						{/if}

						{#if runtimeLabel}
							<span
								class="inline-flex items-center gap-1.5 text-[12px] text-white/85
								       drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] tv:text-base"
							>
								<Icon name="clock" size={13} class="opacity-70" />
								{runtimeLabel}
							</span>
						{/if}

						{#if title.ageRating}
							<span
								class="tnum inline-flex items-center rounded border border-white/30 px-1.5
								       text-[11.5px] font-medium text-white/90
								       drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] tv:text-base"
								title="Возрастной рейтинг"
							>
								{title.ageRating}
							</span>
						{/if}

						{#if title.jellyfinId}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-good/40
								       bg-good/15 px-2.5 py-1 text-[11.5px] font-medium text-good backdrop-blur-sm"
							>
								<Icon name="check" size={12} />
								В медиатеке
							</span>
						{:else if title.inLibrary}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-accent/40
								       bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent
								       backdrop-blur-sm"
							>
								<Icon name="play" size={11} />
								Онлайн
							</span>
						{/if}
					</div>

					{#if title.logo}
						<img
							src={title.logo}
							alt={title.title}
							class="mb-4 max-h-20 w-auto max-w-[min(26rem,90%)] object-contain object-left
							       drop-shadow-[0_6px_22px_rgba(0,0,0,0.7)] md:max-h-28 tv:max-h-44"
						/>
						<!-- Название текстом всё равно нужно скринридерам и поиску. -->
						<h1 class="sr-only">{title.title}</h1>
					{:else}
						<h1 class="display-lg mb-3 text-3xl text-ink md:text-5xl tv:text-7xl">{title.title}</h1>
					{/if}

					{#if title.originalTitle && title.originalTitle !== title.title}
						<p class="mb-3 text-[13px] text-white/55 tv:text-lg">{title.originalTitle}</p>
					{/if}


					<div class="mb-7 flex flex-wrap items-center gap-x-5 gap-y-3">
						{#if title.rating}
							<div class="flex items-center gap-2.5">
								<RatingArc value={title.rating} votes={title.votes} size={52} />
								<div class="text-[11px] leading-tight">
									<p class="text-white/75">рейтинг TMDB</p>
									{#if title.votes}
										<p class="tnum text-white/55">
											{new Intl.NumberFormat('ru-RU').format(title.votes)} оценок
										</p>
									{/if}
								</div>
							</div>
						{/if}

						{#if title.genreRefs.length}
							<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
								{#each title.genreRefs as g (g.id)}
<!--
										Без рамки и заливки: жанры перетягивали внимание с названия и
										рейтинга, хотя это второстепенная навигация. Остались иконка и
										слово; то, что это ссылка, показывает подчёркивание при
										наведении — обычное поведение ссылки в тексте.
									-->
									<a
										href="/catalog/{title.type === 'movie' ? 'movies' : 'shows'}?g={g.id}"
										class="inline-flex items-center gap-1.5 text-[12.5px] text-white/85
										       drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] transition
										       duration-[var(--t-fast)] hover:text-accent hover:underline
										       hover:decoration-accent/50 hover:underline-offset-4 tv:text-lg"
									>
										<GenreIcon id={g.id} size={14} />
										{g.name}
									</a>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Действия -->
					<div class="flex flex-wrap items-center gap-2.5">
						{#if canWatch && watchHref}
							<a
								href={watchHref}
								class="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-7 text-sm
								       font-semibold text-accent-ink transition duration-[var(--t-fast)]
								       hover:bg-accent-hover tv:h-16 tv:px-10 tv:text-lg"
								style="box-shadow: var(--glow-md)"
							>
								<Icon name="play" size={16} />
								{title.type === 'movie' ? 'Смотреть' : 'Смотреть с 1 серии'}
							</a>
						{:else}
							<!--
								Недоступность объясняем, а не констатируем. «Нет в медиатеке» само
								по себе выглядит поломкой сайта, хотя причина обычно в том, что
								источник воспроизведения просто не подключён.
							-->
							<div
								class="inline-flex h-12 items-center gap-2.5 rounded-full border border-white/20
								       bg-black/45 px-7 text-sm text-white/70 backdrop-blur-md"
								title={unavailableHint}
							>
								<Icon name="info" size={16} />
								{unavailableLabel}
							</div>
						{/if}

						{#if title.trailerKey}
							<button
								type="button"
								onclick={() => (trailerOpen = true)}
								class="inline-flex h-12 items-center gap-2 rounded-full border border-white/20
								       bg-black/45 px-6 text-sm font-medium text-white backdrop-blur-md transition
								       duration-[var(--t-fast)] hover:border-white/40 hover:bg-black/70"
							>
								<Icon name="play" size={14} />
								Трейлер
							</button>
						{/if}

						<button
							type="button"
							onclick={() => lists.toggle('later', title)}
							aria-pressed={inLater}
							title={inLater ? 'Убрать из «Смотреть позже»' : 'Смотреть позже'}
							class="grid h-12 w-12 place-items-center rounded-full border backdrop-blur-md
							       transition duration-[var(--t-fast)] tv:h-16 tv:w-16 {inLater
								? 'border-accent bg-accent text-accent-ink'
								: 'border-white/20 bg-black/45 text-white hover:border-white/40'}"
						>
							<Icon name={inLater ? 'check' : 'bookmark'} size={17} />
						</button>

						<button
							type="button"
							onclick={() => lists.toggle('favorite', title)}
							aria-pressed={inFav}
							title={inFav ? 'Убрать из избранного' : 'В избранное'}
							class="grid h-12 w-12 place-items-center rounded-full border backdrop-blur-md
							       transition duration-[var(--t-fast)] tv:h-16 tv:w-16 {inFav
								? 'border-accent bg-accent text-accent-ink'
								: 'border-white/20 bg-black/45 text-white hover:border-white/40'}"
						>
							<Icon name="heart" size={17} filled={inFav} />
						</button>
					</div>
				</div>
			</div>
		</div>
	</section>

	<div class="mx-auto mt-14 max-w-[var(--page-max)] space-y-14">
		<!--
			============================== о чём ================================
			Описание переехало сюда с кадра. Здесь под текстом плотная подложка
			(bg-surface), поэтому обычный текстовый цвет даёт нормальный контраст и
			читать можно построчно, а не угадывать буквы на фотографии.

			Рядом — короткая справка о том, что нужно для решения «смотреть или
			нет»: год, длительность, возраст, страна, язык. Производственные факты
			(бюджет, сборы, статус, даты) остались в своём блоке ниже: это другой
			вопрос и другой момент интереса.
		-->
		{#if title.overview}
			<section class="px-[var(--gutter)]" use:reveal>
				<!--
					Заголовок такой же, как у «О производстве» и остальных секций: раньше
					здесь была мелкая надстрочная подпись, и блок читался как служебная
					врезка, а не как раздел страницы. Одинаковые разделы должны выглядеть
					одинаково — иначе иерархия страницы врёт.

					Акцентной полосы слева больше нет: описание и так единственное, что
					стоит в этом месте, отделять его нечем не нужно.

					Колонку с годом, длительностью и страной убрал: год и длительность
					дословно повторяли чипсы над названием, а страна переехала в «О
					производстве», где стоят остальные производственные факты.
				-->
				<h2 class="mb-4 text-[19px] font-semibold tracking-tight text-ink tv:text-3xl">О чём</h2>

				<div class="max-w-4xl">
					<p
						class="text-[15px] leading-[1.75] text-ink/90 md:text-[16.5px] tv:text-2xl
						       tv:leading-[1.7]"
						class:line-clamp-6={!overviewOpen}
					>
						{title.overview}
					</p>
					{#if title.overview.length > 480}
						<button
							type="button"
							onclick={() => (overviewOpen = !overviewOpen)}
							aria-expanded={overviewOpen}
							class="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-accent transition
							       duration-[var(--t-fast)] hover:text-accent-hover tv:text-lg"
						>
							{overviewOpen ? 'Свернуть' : 'Читать полностью'}
							<Icon
								name="chevronDown"
								size={13}
								class="transition-transform duration-[var(--t-mid)] {overviewOpen
									? 'rotate-180'
									: ''}"
							/>
						</button>
					{/if}

					{#if title.tagline}
						<!-- Слоган живёт здесь, а не на кадре: на фотографии он был лишней
						     строкой поверх картинки, а тут работает подписью к описанию. -->
						<p class="mt-5 font-display text-[14px] italic leading-snug text-faint tv:text-xl">
							{title.tagline}
						</p>
					{/if}
				</div>
			</section>
		{/if}

		<!-- ============================ где смотреть ========================== -->
		{#if offers.length}
			<section class="px-[var(--gutter)]" use:reveal>
				<!--
					Переделано из «коробки с квадратиками».

					Было: рамка вокруг всего, внутри группы по способу просмотра, а сами
					сервисы — безымянные логотипы 44×44. Логотип без подписи узнаётся
					только если он и так знаком, поэтому половина плиток читалась как
					цветные квадраты.

					Стало: способ просмотра — заголовок строки с ценовым смыслом
					(«по подписке» это не то же, что «аренда»), а сервис — плитка с
					логотипом И названием. Рамка вокруг блока не нужна: строки уже
					разделены линиями.
				-->
				<div class="mb-4 flex items-baseline justify-between gap-4">
					<h2 class="text-[19px] font-semibold tracking-tight text-ink tv:text-3xl">
						Где смотреть
					</h2>
					{#if title.providers?.link}
						<a
							href={title.providers.link}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex shrink-0 items-center gap-1.5 text-xs text-dim transition
							       duration-[var(--t-fast)] hover:text-accent tv:text-base"
						>
							Все варианты
							<Icon name="external" size={13} />
						</a>
					{/if}
				</div>

				<div class="divide-y divide-line-soft">
					{#each offers as group (group.label)}
						<div class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6">
							<p
								class="shrink-0 text-[12px] font-medium uppercase tracking-wider text-faint
								       sm:w-36 tv:w-52 tv:text-base"
							>
								{group.label}
							</p>

							<div class="flex flex-wrap gap-2">
								{#each group.items as prov (prov.id)}
									<a
										href={title.providers?.link ?? 'https://www.themoviedb.org'}
										target="_blank"
										rel="noopener noreferrer"
										aria-label="{prov.name} — {group.label}"
										class="group/prov inline-flex items-center gap-2.5 rounded-full border
										       border-line-soft bg-surface/50 py-1.5 pl-1.5 pr-3.5 transition
										       duration-[var(--t-fast)] hover:border-line-strong hover:bg-surface-2"
									>
										{#if prov.logo}
											<img
												src={prov.logo}
												alt=""
												loading="lazy"
												class="h-7 w-7 shrink-0 rounded-full object-cover tv:h-10 tv:w-10"
											/>
										{:else}
											<span
												class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3
												       text-[10px] text-dim tv:h-10 tv:w-10"
												aria-hidden="true"
											>
												{prov.name.slice(0, 2)}
											</span>
										{/if}
										<span
											class="text-[12.5px] text-ink transition duration-[var(--t-fast)]
											       group-hover/prov:text-accent tv:text-base"
										>
											{prov.name}
										</span>
									</a>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<!-- Прямых deep-link TMDB не отдаёт: ссылка ведёт на их страницу выбора. -->
				<p class="mt-3 text-[11px] text-faint tv:text-sm">
					Данные о доступности — JustWatch. Ссылка открывает страницу выбора сервиса на TMDB.
				</p>
			</section>
		{/if}

		<!-- ============================ сезоны и серии ======================== -->
		{#if title.type === 'show' && title.seasons.length}
			<SeasonsBlock
				{base}
				seasons={title.seasons}
				{season}
				{episodes}
				nextEpisode={title.nextEpisode}
				episodeGroups={title.episodeGroups}
			/>
		{/if}

		<!-- ================================ актёры ============================ -->
		{#if title.cast.length}
			<!--
				RowShell, а не просто прокручиваемый div.

				Раньше здесь был голый ряд со снапом: формально он прокручивался, но у
				него не было ни стрелок, ни видимой полосы — мышью без горизонтального
				колеса ряд не сдвинуть вообще, и дальше шестого актёра было не попасть.
				Каркас ряда — тот же, что на главной, со стрелками по наведению.
			-->
			<div use:reveal>
				<RowShell title="В ролях">
					{#each title.cast as person (String(person.id) + person.name)}
						<!-- Актёр — ссылка на страницу персоны. Раньше это был текст, то
						     есть тупик: «а что ещё с ним» приходилось искать вручную. -->
						<svelte:element
							this={person.id ? 'a' : 'div'}
							href={person.id ? `/person/${toSlug(person.id, person.name)}` : undefined}
							class="group w-[6.5rem] shrink-0 text-center tv:w-[10rem]"
						>
							<div
								class="mb-2 aspect-square overflow-hidden rounded-full bg-surface ring-1
								       ring-line-soft transition duration-[var(--t-mid)]
								       group-hover:ring-accent/45"
							>
								{#if person.photo}
									<img
										src={person.photo}
										alt=""
										loading="lazy"
										class="h-full w-full object-cover transition duration-[var(--t-slow)]
										       group-hover:scale-105"
									/>
								{:else}
									<span
										class="grid h-full place-items-center font-display text-lg text-faint
										       tv:text-3xl"
										aria-hidden="true"
									>
										{person.name.charAt(0)}
									</span>
								{/if}
							</div>
							<p
								class="truncate text-[12px] font-medium text-ink transition
								       duration-[var(--t-fast)] group-hover:text-accent tv:text-lg"
							>
								{person.name}
							</p>
							{#if person.character}
								<p class="line-clamp-2 text-[11px] leading-snug text-faint tv:text-base">
									{person.character}
								</p>
							{/if}
							{#if person.episodeCount}
								<p class="tnum mt-0.5 text-[10px] text-faint/70 tv:text-sm">
									{person.episodeCount} серий
								</p>
							{/if}
						</svelte:element>
					{/each}
				</RowShell>
			</div>
		{/if}

		<!-- ============================ факты и команда ======================= -->
		{#if facts.length || title.crew.length}
			<section class="px-[var(--gutter)]" use:reveal>
				<div class="grid gap-9 lg:grid-cols-[1fr_1.4fr]">
					{#if facts.length || title.facts.companies.length || title.facts.networks.length}
						<div>
							<h2 class="mb-4 text-[19px] font-semibold tracking-tight text-ink tv:text-3xl">
								О производстве
							</h2>
							<dl class="space-y-2.5">
								{#each facts as fact (fact.label)}
									<div
										class="flex items-baseline justify-between gap-4 border-b border-line-soft pb-2.5"
									>
										<dt class="flex items-center gap-2 text-[12px] text-faint">
											<Icon name={fact.icon} size={13} class="shrink-0" />
											{fact.label}
										</dt>
										<dd class="text-right text-[13px] text-ink">{fact.value}</dd>
									</div>
								{/each}
							</dl>

							{#if title.facts.networks.length || title.facts.companies.length}
								{@const orgs = [...title.facts.networks, ...title.facts.companies].slice(0, 6)}
								<div class="mt-5">
									<p class="eyebrow mb-3">
										{title.facts.networks.length ? 'Сети и студии' : 'Студии'}
									</p>
									<div class="flex flex-wrap items-center gap-3">
										{#each orgs as org (org.id)}
											{#if org.logo}
												<!-- Логотипы студий приходят прозрачными PNG под светлый фон,
												     поэтому в тёмной теме их надо инвертировать. -->
												<img
													src={org.logo}
													alt={org.name}
													title={org.name}
													loading="lazy"
													class="h-6 w-auto max-w-24 object-contain opacity-55 invert transition
													       hover:opacity-85"
												/>
											{:else}
												<span class="text-[11px] text-faint">{org.name}</span>
											{/if}
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}

					{#if title.crew.length}
						<div>
							<h2 class="mb-4 text-[19px] font-semibold tracking-tight text-ink tv:text-3xl">
								Съёмочная группа
							</h2>
							<div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
								{#each title.crew.slice(0, 6) as group (group.department)}
									<div>
										<p class="eyebrow mb-2">{group.department}</p>
										<ul class="space-y-1">
											{#each group.people.slice(0, 5) as person (String(person.id) + person.job)}
												<li class="text-[12.5px] leading-snug">
													{#if person.id}
														<a
															href="/person/{toSlug(person.id, person.name)}"
															class="text-ink transition hover:text-accent"
														>
															{person.name}
														</a>
													{:else}
														<span class="text-ink">{person.name}</span>
													{/if}
													<span class="text-faint"> — {person.job}</span>
												</li>
											{/each}
										</ul>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- ================================ франшиза ========================== -->
		{#if title.collection}
			<section class="px-[var(--gutter)]" use:reveal>
				<a
					href="/collection/{toSlug(title.collection.id, title.collection.name)}"
					class="group relative flex items-center gap-5 overflow-hidden rounded-lg border
					       border-line-soft p-5 transition hover:border-line-strong"
				>
					{#if title.collection.backdrop}
						<img
							src={title.collection.backdrop}
							alt=""
							loading="lazy"
							class="absolute inset-0 h-full w-full object-cover opacity-20 transition duration-[var(--t-slower)]
							       group-hover:scale-105 group-hover:opacity-30"
						/>
					{/if}
					<div
						class="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/85 to-canvas/45"
					></div>

					{#if title.collection.poster}
						<img
							src={title.collection.poster}
							alt=""
							loading="lazy"
							class="relative aspect-[2/3] w-16 shrink-0 rounded-sm object-cover shadow-2"
						/>
					{/if}
					<div class="relative min-w-0 flex-1">
						<p class="eyebrow mb-1">Часть франшизы</p>
						<h2
							class="truncate text-[16px] font-semibold text-ink transition group-hover:text-accent"
						>
							{title.collection.name}
						</h2>
					</div>
					<span class="relative shrink-0 text-accent"><Icon name="chevronRight" size={18} /></span>
				</a>
			</section>
		{/if}

		<!-- ================================ галерея =========================== -->
		{#if title.gallery.backdrops.length || title.gallery.posters.length}
			<!-- Тот же каркас со стрелками, что у актёров: голый ряд мышью не
			     сдвигался. Переключатель кадров и постеров уехал в правую часть
			     заголовка ряда. -->
			<div use:reveal>
				<RowShell title="Галерея">
					{#snippet action()}
						<div class="flex shrink-0 gap-1.5">
							{#if title.gallery.backdrops.length}
								<Chip
									size="sm"
									active={galleryTab === 'backdrops'}
									onclick={() => (galleryTab = 'backdrops')}
								>
									Кадры
								</Chip>
							{/if}
							{#if title.gallery.posters.length}
								<Chip
									size="sm"
									active={galleryTab === 'posters'}
									onclick={() => (galleryTab = 'posters')}
								>
									Постеры
								</Chip>
							{/if}
						</div>
					{/snippet}

					{#each gallery as img, i (img.full)}
						<!--
							Кнопка, а не ссылка в новую вкладку: раньше кадр открывался
							отдельной страницей с голым изображением, где нечего листать и
							откуда возвращаются кнопкой «назад».
						-->
						<button
							type="button"
							onclick={() => (shot = i)}
							aria-label="Открыть изображение {i + 1} из {gallery.length}"
							class="lift block shrink-0 overflow-hidden rounded-md ring-1 ring-line-soft
							       transition duration-[var(--t-mid)] hover:ring-accent/45"
						>
							<img
								src={img.url}
								alt=""
								loading="lazy"
								class="{galleryTab === 'backdrops'
									? 'h-40 tv:h-64'
									: 'h-56 tv:h-80'} w-auto object-cover"
							/>
						</button>
					{/each}
				</RowShell>
			</div>
		{/if}

		<!-- ============================ ключевые слова ======================== -->
		{#if title.keywords.length}
			<section class="px-[var(--gutter)]" use:reveal>
				<h2 class="mb-3.5 text-[19px] font-semibold tracking-tight text-ink">Темы и мотивы</h2>
				<div class="flex flex-wrap gap-1.5">
					{#each title.keywords.slice(0, 24) as kw (kw.id)}
						<!-- Ключевые слова точнее жанров и ведут в каталог готовым запросом:
						     это самый короткий путь к «такому же». -->
						<Chip href="/keyword/{toSlug(kw.id, kw.name)}" size="sm" tone="ghost">
							{kw.name}
						</Chip>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ================================ отзывы ============================ -->
		{#if title.reviews.length}
			<section class="px-[var(--gutter)]" use:reveal>
				<h2 class="mb-4 text-[19px] font-semibold tracking-tight text-ink tv:text-3xl">Отзывы</h2>
				<div class="grid gap-3.5 lg:grid-cols-2">
					{#each title.reviews.slice(0, 4) as review (review.author + (review.createdAt ?? ''))}
						<article class="rounded-md border border-line-soft bg-surface/40 p-4">
							<div class="mb-2.5 flex items-center gap-2.5">
								<div class="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2">
									{#if review.avatar}
										<img
											src={review.avatar}
											alt=""
											loading="lazy"
											class="h-full w-full object-cover"
										/>
									{:else}
										<span
											class="grid h-full place-items-center text-[11px] font-semibold text-faint"
											aria-hidden="true"
										>
											{review.author.charAt(0).toUpperCase()}
										</span>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate text-[12.5px] font-medium text-ink">{review.author}</p>
									{#if review.createdAt}
										<p class="text-[10.5px] text-faint">{fmtDate(review.createdAt)}</p>
									{/if}
								</div>
								{#if review.rating}
									<span class="tnum flex shrink-0 items-center gap-1 text-[12px] text-dim">
										<Icon name="star" size={11} />
										{review.rating}
									</span>
								{/if}
							</div>
							<p class="line-clamp-6 text-[12.5px] leading-relaxed text-dim">{review.content}</p>
							{#if review.url}
								<a
									href={review.url}
									target="_blank"
									rel="noopener noreferrer"
									class="mt-2.5 inline-flex items-center gap-1 text-[11px] text-faint transition
									       hover:text-accent"
								>
									Читать на TMDB
									<Icon name="external" size={10} />
								</a>
							{/if}
						</article>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ============================ похожее и советы ====================== -->
		{#if title.recommendations.length}
			<MediaRow title="Вам может понравиться" items={title.recommendations} />
		{/if}
		{#if title.similar.length}
			<MediaRow title="Похожее" items={title.similar} />
		{/if}
	</div>
</main>

<!-- ================================= трейлер ============================== -->
{#if trailerOpen && title.trailerKey}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] grid place-items-center bg-black/92 p-4 backdrop-blur-sm"
		onclick={() => (trailerOpen = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Трейлер"
		tabindex="-1"
	>
		<button
			type="button"
			onclick={() => (trailerOpen = false)}
			aria-label="Закрыть трейлер"
			class="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border
			       border-white/15 bg-black/50 text-white transition hover:bg-black/80"
		>
			<Icon name="close" size={20} />
		</button>

		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="aspect-video w-full max-w-5xl overflow-hidden rounded-lg shadow-4"
			onclick={(e) => e.stopPropagation()}
		>
			<iframe
				src="https://www.youtube.com/embed/{title.trailerKey}?autoplay=1"
				title="Трейлер: {title.title}"
				allow="autoplay; encrypted-media; fullscreen"
				allowfullscreen
				class="h-full w-full border-0"
			></iframe>
		</div>
	</div>
{/if}

<!--
	Просмотрщик галереи. Один на страницу: список ему передаёт активная вкладка
	(кадры или постеры), поэтому переключение вкладок само переключает набор.
-->
<Lightbox
	images={gallery.map((g) => ({ full: g.full, thumb: g.url }))}
	index={shot}
	label={galleryTab === 'backdrops' ? 'Кадр' : 'Постер'}
	onclose={() => (shot = null)}
	onindex={(i) => (shot = i)}
/>
