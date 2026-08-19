<script lang="ts">
	/**
	 * Страница персоны.
	 *
	 * Ключевое решение — фильмография списком, а не стеной постеров. У актёра с
	 * тремя сотнями работ сетка карточек не отвечает ни на один реальный вопрос:
	 * кого он играл, в каком году и что из этого фильм, а что сериал. Список с
	 * годами в левой колонке читается как резюме, а именно за этим сюда и приходят.
	 *
	 * Вкладки держим в состоянии компонента, а не в URL: это переключение вида
	 * внутри одной сущности, а не отдельный адрес, который имело бы смысл переслать.
	 */

	import Icon from '$lib/components/ui/Icon.svelte';
	import Lightbox from '$lib/components/Lightbox.svelte';
	import RatingArc from '$lib/components/ui/RatingArc.svelte';
	import { toMediaSlug } from '$lib/slug';
	import type { PersonCredit } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Индекс фотографии в просмотрщике. null — закрыт. */
	let shot = $state<number | null>(null);

	const person = $derived(data.person);

	/* ------------------------------- словари -------------------------------- */

	/**
	 * Департаменты TMDB отдаёт по-английски при любом language — переводим сами.
	 * Формулировки намеренно безличные («Актёрская работа», а не «Актёр»): пол
	 * персоны в нашей модели не хранится, а угадывать его по имени — плохая идея.
	 */
	const DEPARTMENTS: Record<string, string> = {
		Acting: 'Актёрская работа',
		Directing: 'Режиссура',
		Writing: 'Сценарий',
		Production: 'Продюсирование',
		Sound: 'Звук',
		Camera: 'Операторская работа',
		Editing: 'Монтаж',
		Art: 'Художественный отдел',
		'Costume & Make-Up': 'Костюмы и грим',
		'Visual Effects': 'Визуальные эффекты',
		Lighting: 'Свет',
		Crew: 'Съёмочная группа',
		Creator: 'Создатель'
	};

	/** Должности — та же история. Незнакомую оставляем как есть: лучше английское
	    слово, чем пустая строка на месте роли. */
	const JOBS: Record<string, string> = {
		Director: 'Режиссёр',
		'Series Director': 'Режиссёр сериала',
		Writer: 'Сценарист',
		'Series Writer': 'Сценарист сериала',
		Screenplay: 'Сценарий',
		Story: 'Автор истории',
		Novel: 'Автор романа',
		Characters: 'Автор персонажей',
		Creator: 'Создатель',
		Producer: 'Продюсер',
		'Executive Producer': 'Исполнительный продюсер',
		'Co-Producer': 'Сопродюсер',
		'Associate Producer': 'Ассоциированный продюсер',
		'Director of Photography': 'Оператор-постановщик',
		Cinematography: 'Операторская работа',
		Editor: 'Монтажёр',
		'Original Music Composer': 'Композитор',
		Music: 'Музыка',
		'Production Design': 'Художник-постановщик',
		'Art Direction': 'Художник',
		'Costume Design': 'Художник по костюмам',
		'Makeup Artist': 'Гримёр',
		Casting: 'Кастинг',
		'Sound Designer': 'Звукорежиссёр',
		'Visual Effects Supervisor': 'Супервайзер визуальных эффектов',
		Stunts: 'Трюки',
		'Stunt Coordinator': 'Постановщик трюков'
	};

	const jobLabel = (job: string) => JOBS[job] ?? job;

	/* -------------------------------- шапка --------------------------------- */

	/**
	 * Даты форматируем в UTC. TMDB отдаёт «1958-03-05» — браузер разбирает это как
	 * полночь UTC, и в любом западном часовом поясе без явного timeZone дата
	 * съезжает на сутки назад.
	 */
	const dateFmt = new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});

	function formatDate(iso: string): string | null {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
	}

	/** Полных лет между двумя датами. `until` не задан — считаем до сегодня. */
	function fullYears(birth: string, until?: string): number | null {
		const from = new Date(birth);
		const to = until ? new Date(until) : new Date();
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

		let years = to.getUTCFullYear() - from.getUTCFullYear();
		const monthDiff = to.getUTCMonth() - from.getUTCMonth();
		if (monthDiff < 0 || (monthDiff === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1;
		return years >= 0 && years < 130 ? years : null;
	}

	function plural(n: number, one: string, few: string, many: string): string {
		const mod10 = n % 10;
		const mod100 = n % 100;
		if (mod10 === 1 && mod100 !== 11) return one;
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
		return many;
	}

	const yearsLabel = (n: number) => `${n} ${plural(n, 'год', 'года', 'лет')}`;

	type MetaIcon = 'film' | 'calendar' | 'globe';

	const meta = $derived.by(() => {
		const out: { key: string; icon: MetaIcon; text: string }[] = [];

		if (person.knownFor) {
			out.push({
				key: 'known',
				icon: 'film',
				text: DEPARTMENTS[person.knownFor] ?? person.knownFor
			});
		}

		const born = person.birthday ? formatDate(person.birthday) : null;
		if (person.birthday && born) {
			if (person.deathday) {
				// Умершая персона: показываем годы жизни целиком, а возраст — на момент
				// смерти. «Ему было бы 96» на странице справочника выглядит дико.
				const died = formatDate(person.deathday);
				const age = fullYears(person.birthday, person.deathday);
				out.push({
					key: 'life',
					icon: 'calendar',
					text: `${born}${died ? ` — ${died}` : ''}${age !== null ? ` · ${yearsLabel(age)}` : ''}`
				});
			} else {
				const age = fullYears(person.birthday);
				out.push({
					key: 'born',
					icon: 'calendar',
					text: `${born}${age !== null ? ` · ${yearsLabel(age)}` : ''}`
				});
			}
		}

		if (person.placeOfBirth) {
			out.push({ key: 'place', icon: 'globe', text: person.placeOfBirth });
		}

		return out;
	});

	/* ------------------------------ биография ------------------------------- */

	let bioOpen = $state(false);

	const bio = $derived(person.biography?.trim() ?? '');
	/** Кнопка нужна, только если текст действительно длиннее четырёх строк —
	    иначе «Читать полностью» ничего не раскрывает и выглядит сломанным. */
	const bioLong = $derived(bio.length > 420);

	/* ----------------------------- фильмография ----------------------------- */

	interface Entry {
		key: string;
		item: PersonCredit;
		/** Роли и должности одного тайтла, уже переведённые. */
		roles: string[];
	}

	interface YearGroup {
		key: string;
		label: string;
		entries: Entry[];
	}

	/**
	 * Группировка по годам со склейкой повторов.
	 *
	 * TMDB отдаёт по записи на каждую работу, поэтому режиссёр, он же сценарист
	 * одного фильма приезжает двумя строками — в списке это выглядит как дубль.
	 * Склеиваем по тайтлу и перечисляем должности через запятую.
	 */
	function groupByYear(credits: PersonCredit[]): YearGroup[] {
		const byYear = new Map<number, Entry[]>();

		for (const credit of credits) {
			// -1 — «даты нет»: так TMDB помечает анонсы и незавершённые проекты.
			const year = credit.year ?? -1;
			const entries = byYear.get(year) ?? [];
			const key = `${credit.type}-${credit.tmdbId}`;
			const role = credit.job ? jobLabel(credit.job) : credit.character?.trim();

			const same = entries.find((e) => e.key === key);
			if (same) {
				if (role && !same.roles.includes(role)) same.roles.push(role);
			} else {
				entries.push({ key, item: credit, roles: role ? [role] : [] });
			}

			byYear.set(year, entries);
		}

		return [...byYear.entries()]
			.sort((a, b) => b[0] - a[0])
			.map(([year, entries]) => ({
				key: String(year),
				label: year > 0 ? String(year) : 'Без даты',
				entries
			}));
	}

	const movies = $derived(person.acting.filter((c) => c.type === 'movie'));
	const shows = $derived(person.acting.filter((c) => c.type === 'show'));

	const groups = $derived({
		movies: groupByYear(movies),
		shows: groupByYear(shows),
		crew: groupByYear(person.crew)
	});

	/* -------------------------------- вкладки -------------------------------- */

	type TabId = 'movies' | 'shows' | 'crew' | 'photos';

	const tabs = $derived(
		[
			{ id: 'movies' as const, label: 'Фильмы', count: movies.length },
			{ id: 'shows' as const, label: 'Сериалы', count: shows.length },
			{ id: 'crew' as const, label: 'Съёмочная группа', count: person.crew.length },
			{ id: 'photos' as const, label: 'Фото', count: person.photos.length }
		].filter((tab) => tab.count > 0)
	);

	let picked = $state<TabId | null>(null);

	/** Выбранная вкладка сверяется со списком доступных: у режиссёра нет вкладки
	    «Фильмы», и после перехода с актёрской страницы выбор нужно откатить. */
	const activeTab = $derived(
		picked && tabs.some((t) => t.id === picked) ? picked : (tabs[0]?.id ?? null)
	);

	const activeGroups = $derived(
		activeTab === 'movies' || activeTab === 'shows' || activeTab === 'crew'
			? groups[activeTab]
			: []
	);

	const activeLabel = $derived(tabs.find((t) => t.id === activeTab)?.label ?? '');

	const numberFmt = new Intl.NumberFormat('ru-RU');

	const description = $derived(
		bio
			? bio.slice(0, 160)
			: `${person.name}: фильмография, роли и фотографии${
					person.knownFor ? ` — ${(DEPARTMENTS[person.knownFor] ?? person.knownFor).toLowerCase()}` : ''
				}.`
	);
</script>

<svelte:head>
	<title>{person.name} — КИНЕМА</title>
	<meta name="description" content={description} />
</svelte:head>

<main class="pb-16 md:pb-20">
	<!-- Шапка -->
	<section class="relative border-b border-line-soft">
		<div class="aurora" aria-hidden="true"></div>

		<div class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-8 md:py-11">
			<div class="flex flex-col gap-7 md:flex-row md:gap-10">
				<div class="w-40 shrink-0 sm:w-48 md:w-60 lg:w-64">
					<div class="aspect-[2/3] overflow-hidden rounded-md bg-surface ring-1 ring-line-soft shadow-3">
						{#if person.photo}
							<img
								src={person.photo}
								alt=""
								fetchpriority="high"
								decoding="async"
								class="h-full w-full object-cover"
							/>
						{:else}
							<!-- Фото нет: не серый прямоугольник, а понятная заглушка. -->
							<div class="grid h-full w-full place-items-center bg-gradient-to-br from-surface-2 to-surface text-faint">
								<Icon name="user" size={44} />
							</div>
						{/if}
					</div>
				</div>

				<div class="min-w-0 flex-1">
					<p class="eyebrow mb-3">Персона</p>

					<h1 class="display-lg text-3xl text-ink md:text-[2.75rem]">{person.name}</h1>

					{#if meta.length}
						<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-dim">
							{#each meta as row, i (row.key)}
								{#if i > 0}
									<span class="text-faint" aria-hidden="true">·</span>
								{/if}
								<span class="inline-flex items-center gap-1.5">
									<span class="text-faint"><Icon name={row.icon} size={14} /></span>
									{row.text}
								</span>
							{/each}
						</div>
					{/if}

					<div class="mt-6 max-w-3xl">
						{#if bio}
							<p
								id="person-bio"
								class="whitespace-pre-line text-[14px] leading-relaxed text-dim
								       {bioLong && !bioOpen ? 'line-clamp-4' : ''}"
							>
								{bio}
							</p>

							{#if bioLong}
								<button
									type="button"
									onclick={() => (bioOpen = !bioOpen)}
									aria-expanded={bioOpen}
									aria-controls="person-bio"
									class="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent transition
									       hover:text-accent-hover"
								>
									{bioOpen ? 'Свернуть' : 'Читать полностью'}
									<Icon
										name="chevronDown"
										size={14}
										class="transition-transform duration-[var(--t-mid)] {bioOpen ? 'rotate-180' : ''}"
									/>
								</button>
							{/if}
						{:else}
							<p class="text-[13.5px] leading-relaxed text-dim">
								Русской биографии в TMDB нет — тексты туда пишет сообщество, и до большинства
								персон руки не доходят. По той же причине имя выше приведено в оригинальном
								написании: имена персон TMDB не переводит ни на один язык, это ограничение
								самого API, а не пропуск в данных.
							</p>
						{/if}
					</div>

					{#if person.imdbId}
						<a
							href="https://www.imdb.com/name/{person.imdbId}/"
							target="_blank"
							rel="noopener noreferrer"
							class="mt-6 inline-flex h-9 items-center gap-2 rounded-full border border-line
							       px-4 text-xs text-dim transition hover:border-line-strong hover:text-ink"
						>
							Профиль на IMDb
							<Icon name="external" size={13} />
						</a>
					{/if}
				</div>
			</div>
		</div>
	</section>

	{#if tabs.length}
		<!-- Вкладки. Липнут к шапке: фильмография длинная, и возможность
		     переключиться на середине списка важнее пары пикселей высоты. -->
		<div class="glass sticky top-[var(--header-h)] z-30 border-b border-line-soft">
			<div class="mx-auto max-w-[var(--page-max)] px-[var(--gutter)]">
				<div class="no-scrollbar flex gap-6 overflow-x-auto">
					{#each tabs as tab (tab.id)}
						{@const isActive = tab.id === activeTab}
						<button
							type="button"
							onclick={() => (picked = tab.id)}
							aria-current={isActive ? 'true' : undefined}
							aria-controls="person-panel"
							class="-mb-px shrink-0 whitespace-nowrap border-b-2 py-3.5 text-[13.5px] transition
							       {isActive
								? 'border-accent font-medium text-ink'
								: 'border-transparent text-dim hover:text-ink'}"
						>
							{tab.label}
							<span class="tnum ml-1 text-[11px] text-faint">{numberFmt.format(tab.count)}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- section с aria-label — это уже landmark region, отдельный role не нужен. -->
		<section
			id="person-panel"
			aria-label={activeLabel}
			class="mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-8 md:py-11"
		>
			{#if activeTab === 'photos'}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 md:gap-4">
					{#each person.photos as photo, i (photo.full)}
						<!-- Открывается просмотрщиком поверх страницы, а не новой вкладкой:
						     фотографий у актёра десятки, и листать их надо на месте. -->
						<button
							type="button"
							onclick={() => (shot = i)}
							aria-label="Открыть фото {i + 1} из {person.photos.length}"
							class="group relative block overflow-hidden rounded-md bg-surface ring-1 ring-line-soft
							       transition duration-[var(--t-mid)] hover:ring-line-strong"
						>
							<img
								src={photo.url}
								alt=""
								loading="lazy"
								decoding="async"
								class="aspect-[2/3] w-full object-cover transition-transform duration-[var(--t-slow)]
								       group-hover:scale-[1.04]"
							/>
							<span
								class="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full
								       bg-black/60 text-white opacity-0 backdrop-blur-md transition
								       duration-[var(--t-mid)] group-hover:opacity-100
								       group-focus-visible:opacity-100"
								aria-hidden="true"
							>
								<Icon name="fullscreen" size={13} />
							</span>
						</button>
					{/each}
				</div>
			{:else}
				<div class="space-y-8 md:space-y-10">
					{#each activeGroups as group (group.key)}
						<div class="md:flex md:gap-8">
							<!-- Год липнет к вкладкам: при прокрутке длинного года видно,
							     о каком периоде идёт речь. -->
							<div class="mb-2.5 md:mb-0 md:w-20 md:shrink-0 md:self-start md:sticky md:top-32">
								<div class="tnum text-sm font-medium text-faint md:text-right">{group.label}</div>
							</div>

							<ul class="min-w-0 flex-1 space-y-1">
								{#each group.entries as entry (entry.key)}
									{@const item = entry.item}
									<li>
										<a
											href="/{item.type}/{toMediaSlug(item)}"
											class="group flex items-center gap-3.5 rounded-md p-2 transition
											       hover:bg-surface"
										>
											<div
												class="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-sm bg-surface-2
												       ring-1 ring-line-soft"
											>
												{#if item.poster}
													<img
														src={item.poster}
														alt=""
														loading="lazy"
														decoding="async"
														class="h-full w-full object-cover"
													/>
												{:else}
													<div class="grid h-full w-full place-items-center text-faint">
														<Icon name={item.type === 'movie' ? 'film' : 'tv'} size={18} />
													</div>
												{/if}
											</div>

											<div class="min-w-0 flex-1">
												<div class="flex items-baseline gap-2">
													<span
														class="truncate text-[14px] font-medium text-ink transition-colors
														       group-hover:text-accent"
													>
														{item.title}
													</span>
													{#if item.year}
														<span class="tnum shrink-0 text-[11px] text-faint">{item.year}</span>
													{/if}
												</div>

												{#if entry.roles.length}
													<p class="mt-0.5 truncate text-[12.5px] text-dim">
														{entry.roles.join(', ')}
													</p>
												{:else}
													<p class="mt-0.5 text-[12.5px] text-faint">Роль в титрах не указана</p>
												{/if}

												<div class="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
													<span>{item.type === 'movie' ? 'Фильм' : 'Сериал'}</span>
													{#if item.inLibrary}
														<span
															class="inline-flex h-5 items-center gap-1 rounded-full border
															       border-accent/35 bg-accent-soft px-1.5 font-medium text-accent"
														>
															<Icon name="play" size={9} />
															В медиатеке
														</span>
													{/if}
												</div>
											</div>

											{#if item.rating && item.rating > 0}
												<RatingArc value={item.rating} votes={item.votes} size={34} />
											{/if}
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<section class="mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-20 text-center">
			<p class="mb-2 text-[15px] text-ink">Работ в базе пока нет</p>
			<p class="mx-auto max-w-md text-[13px] leading-relaxed text-dim">
				TMDB знает эту персону, но ни одного фильма, сериала или фото за ней не числится. Так
				бывает у новых карточек: их заводят под будущий проект, а титры добавляют позже.
			</p>
		</section>
	{/if}
</main>

<Lightbox
	images={data.person.photos.map((p) => ({ full: p.full, thumb: p.url }))}
	index={shot}
	label="Фото"
	onclose={() => (shot = null)}
	onindex={(i) => (shot = i)}
/>
