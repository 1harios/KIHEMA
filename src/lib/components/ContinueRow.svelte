<script lang="ts">
	/**
	 * Ряд «Продолжить просмотр».
	 *
	 * Карточки здесь горизонтальные, с кадром вместо постера, — и это не
	 * декоративное отличие. Постер отвечает на вопрос «что это?», а в этом ряду
	 * вопрос другой: «где я остановился?». Кадр плюс полоса прогресса отвечают на
	 * него сразу, и ряд не путается с остальными девятью подборками из постеров.
	 *
	 * Данные целиком клиентские (localStorage), поэтому на сервере ряда нет и
	 * разметка появляется после гидрации. Место под него не резервируется: пустой
	 * заголовок «Продолжить просмотр» у нового пользователя хуже, чем его
	 * отсутствие.
	 */

	import { progress, resumeHref, type ProgressEntry } from '$lib/progress.svelte';
	import { toSlug } from '$lib/slug';
	import Icon from './ui/Icon.svelte';
	import RowShell from './RowShell.svelte';

	const items = $derived(progress.items);

	const titleHref = (e: ProgressEntry) =>
		`/${e.type === 'movie' ? 'movie' : 'show'}/${toSlug(e.tmdbId, e.title)}`;

	/** Сколько осталось. Минуты, а не проценты: минуты решают, включать ли сейчас. */
	function left(e: ProgressEntry): string {
		const sec = Math.max(0, e.durationSec - e.positionSec);
		const min = Math.round(sec / 60);
		if (min < 1) return 'Меньше минуты';
		if (min < 60) return `Осталось ${min} мин`;
		const h = Math.floor(min / 60);
		const rest = min % 60;
		return rest ? `Осталось ${h} ч ${rest} мин` : `Осталось ${h} ч`;
	}

	/**
	 * Номер серии без названия.
	 *
	 * Название сначала было здесь же, но в строке с остатком времени оно
	 * обрезалось на середине и упиралось в разделитель: получалось «Калеки,
	 * бастарды и сл… · Осталось 31 мин». Номер отвечает на вопрос «где я
	 * остановился» полностью, а название уходит в подсказку карточки.
	 */
	const episodeLabel = (e: ProgressEntry): string | null =>
		e.type === 'show' ? `S${e.season ?? 1} · E${e.episode ?? 1}` : null;

	/** Полная подпись для title — там места достаточно. */
	function fullLabel(e: ProgressEntry): string {
		const parts = [e.title];
		const num = episodeLabel(e);
		if (num) parts.push(e.episodeTitle ? `${num} · ${e.episodeTitle}` : num);
		parts.push(left(e));
		return parts.join(' · ');
	}
</script>

{#if items.length}
	<RowShell title="Продолжить просмотр">
		{#snippet action()}
			<button
				type="button"
				onclick={() => progress.clear()}
				class="shrink-0 text-xs text-faint transition duration-[var(--t-fast)] hover:text-ink"
			>
				Очистить
			</button>
		{/snippet}

		{#each items as entry (entry.type + entry.tmdbId + (entry.season ?? '') + (entry.episode ?? ''))}
			<div class="group/card relative w-[15rem] shrink-0 md:w-[18.5rem] tv:w-[26rem]">
				<div
					class="lift relative aspect-video overflow-hidden rounded-md bg-surface ring-1
					       ring-line-soft transition duration-[var(--t-slow)]
					       ease-[var(--ease-out-quint)] group-hover/card:shadow-3
					       group-hover/card:ring-2 group-hover/card:ring-accent/45"
				>
					{#if entry.backdrop || entry.poster}
						<img
							src={entry.backdrop ?? entry.poster}
							alt=""
							loading="lazy"
							decoding="async"
							class="h-full w-full object-cover transition-transform duration-[var(--t-slower)]
							       ease-[var(--ease-out-quint)] group-hover/card:scale-[1.05]"
						/>
					{:else}
						<div
							class="flex h-full items-center justify-center bg-gradient-to-br from-surface-2
							       to-surface p-3 text-center font-display text-sm text-faint"
						>
							{entry.title}
						</div>
					{/if}

					<div
						class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85
						       via-black/20 to-transparent"
					></div>

					<!-- Кнопка продолжения: главное действие ряда, поэтому видна сразу,
					     а не только при наведении. На тач-устройствах hover нет вообще. -->
					<a
						href={resumeHref(entry, titleHref(entry))}
						title="Продолжить: {entry.title}"
						class="absolute left-1/2 top-1/2 z-20 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2
						       place-items-center rounded-full bg-accent/90 text-accent-ink backdrop-blur-sm
						       transition-all duration-[var(--t-mid)] ease-[var(--ease-spring)]
						       hover:bg-accent group-hover/card:scale-110 tv:h-16 tv:w-16"
						style="box-shadow: var(--glow-sm)"
					>
						<span class="ml-0.5"><Icon name="play" size={20} /></span>
					</a>

					<!-- Убрать из ряда. Появляется при наведении: постоянный крестик на
					     каждой карточке читается как «закрыть», а не «забыть». -->
					<button
						type="button"
						onclick={() => progress.remove(entry)}
						title="Убрать из «Продолжить просмотр»"
						aria-label="Убрать {entry.title} из продолжения просмотра"
						class="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full
						       border border-white/15 bg-black/60 text-white opacity-0 backdrop-blur-md
						       transition duration-[var(--t-mid)] hover:bg-black/85
						       group-hover/card:opacity-100 focus-visible:opacity-100"
					>
						<Icon name="close" size={14} />
					</button>

					<!-- Текст на кадре, а не под ним: так карточка остаётся компактной, а
					     нижняя часть кадра всё равно затемнена градиентом. -->
					<div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 pb-4">
						<div class="truncate text-[13px] font-semibold text-white tv:text-lg">
							{entry.title}
						</div>
						<div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/65 tv:text-sm">
							{#if episodeLabel(entry)}
								<span class="tnum shrink-0">{episodeLabel(entry)}</span>
								<span class="shrink-0 opacity-60" aria-hidden="true">·</span>
							{/if}
							<span class="truncate">{left(entry)}</span>
						</div>
					</div>

					<div
						class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[3px] bg-black/55"
						role="progressbar"
						aria-valuenow={Math.round((entry.positionSec / entry.durationSec) * 100)}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label="Просмотрено"
					>
						<div
							class="h-full bg-accent"
							style="width: {Math.max(2, (entry.positionSec / entry.durationSec) * 100)}%"
						></div>
					</div>

					<!-- Растянутая ссылка на страницу тайтла — под кнопками (z-10 против
					     z-20), поэтому «продолжить» и «убрать» перехватывают клик сами. -->
					<a href={titleHref(entry)} class="absolute inset-0 z-10 rounded-md" title={fullLabel(entry)}>
						<span class="sr-only">{entry.title}</span>
					</a>
				</div>
			</div>
		{/each}
	</RowShell>
{/if}
