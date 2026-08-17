<script lang="ts">
	/**
	 * Сезоны и серии.
	 *
	 * Что добавилось помимо оформления:
	 *
	 * — Обратный отсчёт до следующей серии. Поля next_episode_to_air уже приезжают
	 *   в ответе TMDB вместе с деталями сериала, отдельный запрос не нужен — но их
	 *   никто обычно не показывает, хотя для идущего сериала это самая нужная
	 *   строка на странице.
	 * — Варианты нумерации (episode_groups): абсолютная, DVD, сюжетные арки. Для
	 *   аниме и длинных сериалов это единственный способ понять, «какая это серия».
	 *   Здесь мы показываем, что варианты существуют — переключение требует
	 *   отдельных запросов к /tv/episode_group/{id} и делается по ссылке.
	 * — Крупные карточки серий с кадром: кадр серии (still) — главный ориентир
	 *   «я это уже смотрел», текст описания вторичен.
	 */

	import Chip from './ui/Chip.svelte';
	import Icon from './ui/Icon.svelte';
	import type { EpisodeGroup, EpisodeStub, EpisodeSummary, SeasonSummary } from '$lib/types';

	interface Props {
		base: string;
		seasons: SeasonSummary[];
		season: number | null;
		episodes: EpisodeSummary[];
		nextEpisode?: EpisodeStub;
		episodeGroups: EpisodeGroup[];
	}

	let { base, seasons, season, episodes, nextEpisode, episodeGroups }: Props = $props();

	/** Сколько дней до выхода. null — если дата в прошлом или её нет. */
	const daysUntil = $derived.by(() => {
		if (!nextEpisode?.airDate) return null;
		// Считаем в UTC: иначе «завтра» в разных часовых поясах даёт разный ответ.
		const air = Date.parse(`${nextEpisode.airDate}T00:00:00Z`);
		if (Number.isNaN(air)) return null;
		const now = new Date();
		const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
		const diff = Math.round((air - today) / 86_400_000);
		return diff >= 0 ? diff : null;
	});

	const countdownLabel = $derived.by(() => {
		if (daysUntil === null) return null;
		if (daysUntil === 0) return 'сегодня';
		if (daysUntil === 1) return 'завтра';
		// 2-4 дня, 5-20 дней, 21 день…
		const mod10 = daysUntil % 10;
		const mod100 = daysUntil % 100;
		const word =
			mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
		return `через ${daysUntil} ${word}`;
	});

	const dateFmt = new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	});

	const fmtDate = (iso?: string) => {
		if (!iso) return null;
		const t = Date.parse(`${iso}T00:00:00Z`);
		return Number.isNaN(t) ? null : dateFmt.format(t);
	};

	const runtimeLabel = (sec?: number) => (sec ? `${Math.round(sec / 60)} мин` : null);

	const activeSeason = $derived(seasons.find((s) => s.seasonNumber === season));
</script>

<section class="px-[var(--gutter)]">
	<div class="mb-5 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="mb-1 text-[19px] font-semibold tracking-tight text-ink">Серии</h2>
			{#if activeSeason}
				<p class="text-[12px] text-faint">
					{activeSeason.episodeCount} серий
					{#if activeSeason.airDate}
						· {new Date(activeSeason.airDate).getUTCFullYear()}
					{/if}
					{#if activeSeason.inLibraryCount > 0}
						· <span class="text-good">{activeSeason.inLibraryCount} в медиатеке</span>
					{/if}
				</p>
			{/if}
		</div>

		{#if nextEpisode && countdownLabel}
			<!-- Обратный отсчёт. Данные уже есть в ответе — не показывать их значит
			     выбросить самую полезную строку для идущего сериала. -->
			<div
				class="flex items-center gap-3 rounded-md border border-line-soft bg-surface/60 px-4 py-2.5"
				style="box-shadow: var(--glow-sm)"
			>
				<span class="shrink-0 text-accent"><Icon name="calendar" size={17} /></span>
				<div class="text-[12px] leading-tight">
					<p class="font-medium text-ink">
						Сезон {nextEpisode.seasonNumber}, серия {nextEpisode.episodeNumber} — {countdownLabel}
					</p>
					<p class="text-faint">
						{fmtDate(nextEpisode.airDate)}
						{#if nextEpisode.name}· {nextEpisode.name}{/if}
					</p>
				</div>
			</div>
		{/if}
	</div>

	<!-- Табы сезонов -->
	<div class="snap-row mb-4 gap-1.5 pb-1">
		{#each seasons as s (s.seasonNumber)}
			<Chip href="{base}?season={s.seasonNumber}" active={s.seasonNumber === season}>
				Сезон {s.seasonNumber}
				{#if s.inLibraryCount > 0}
					<span class="tnum opacity-60">· {s.inLibraryCount}</span>
				{/if}
			</Chip>
		{/each}
	</div>

	{#if episodeGroups.length}
		<!-- Альтернативная нумерация. Честно помечено как «на TMDB»: сама выдача
		     серий здесь остаётся в порядке выхода в эфир. -->
		<div class="mb-5 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
			<span>Есть другие варианты нумерации:</span>
			{#each episodeGroups as g (g.id)}
				<a
					href="https://www.themoviedb.org/tv/episode-group/{g.id}"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1
					       transition hover:border-line-strong hover:text-dim"
				>
					{g.name}
					<span class="tnum opacity-70">{g.episodeCount}</span>
					<Icon name="external" size={11} />
				</a>
			{/each}
		</div>
	{/if}

	{#if episodes.length}
		<ol class="grid gap-2.5 lg:grid-cols-2">
			{#each episodes as ep (ep.seasonNumber + 'x' + ep.episodeNumber)}
				{@const href = `${base}/watch?s=${ep.seasonNumber}&e=${ep.episodeNumber}`}
				<li>
					<svelte:element
						this={ep.inLibrary ? 'a' : 'div'}
						href={ep.inLibrary ? href : undefined}
						class="group flex gap-3.5 rounded-md border border-line-soft bg-surface/45 p-3
						       transition {ep.inLibrary
							? 'hover:border-line-strong hover:bg-surface'
							: 'opacity-45'}"
					>
						<div
							class="relative aspect-video w-36 shrink-0 overflow-hidden rounded-sm bg-surface-2
							       sm:w-40"
						>
							{#if ep.still}
								<img
									src={ep.still}
									alt=""
									loading="lazy"
									class="h-full w-full object-cover transition duration-[var(--t-slow)]
									       group-hover:scale-105"
								/>
							{:else}
								<span
									class="tnum grid h-full place-items-center font-display text-lg text-faint"
								>
									{ep.episodeNumber}
								</span>
							{/if}

							{#if ep.inLibrary}
								<div
									class="absolute inset-0 grid place-items-center bg-black/45 opacity-0
									       transition group-hover:opacity-100"
								>
									<span
										class="grid h-9 w-9 place-items-center rounded-full bg-accent
										       text-accent-ink"
									>
										<Icon name="play" size={14} />
									</span>
								</div>
							{/if}

							{#if ep.progress}
								<div class="absolute inset-x-0 bottom-0 h-1 bg-black/55">
									<div class="h-full bg-accent" style="width: {ep.progress * 100}%"></div>
								</div>
							{/if}
						</div>

						<div class="min-w-0 flex-1 py-0.5">
							<div class="mb-1 flex items-baseline gap-2">
								<span class="tnum shrink-0 text-[12px] font-semibold text-faint">
									{ep.episodeNumber}
								</span>
								<h3 class="truncate text-[13.5px] font-medium text-ink">{ep.name}</h3>
							</div>

							<div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
								{#if fmtDate(ep.airDate)}<span>{fmtDate(ep.airDate)}</span>{/if}
								{#if runtimeLabel(ep.runtimeSec)}
									<span aria-hidden="true">·</span>
									<span>{runtimeLabel(ep.runtimeSec)}</span>
								{/if}
								{#if ep.rating}
									<span aria-hidden="true">·</span>
									<span class="tnum flex items-center gap-1 text-dim">
										<Icon name="star" size={10} />
										{ep.rating.toFixed(1)}
									</span>
								{/if}
							</div>

							{#if ep.overview}
								<p class="line-clamp-2 text-[12px] leading-relaxed text-dim">{ep.overview}</p>
							{:else if !ep.inLibrary}
								<p class="text-[11px] text-faint">Нет в медиатеке</p>
							{/if}
						</div>
					</svelte:element>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="py-10 text-center text-[13px] text-dim">
			Список серий этого сезона пока не заполнен на TMDB.
		</p>
	{/if}
</section>
