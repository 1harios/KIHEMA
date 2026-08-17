<script lang="ts">
	/**
	 * Главная.
	 *
	 * Сам герой живёт в HomeHero: там карусель с автолистанием, наездом на кадр,
	 * лентой миниатюр, свайпом и паузой в фоне — логики достаточно, чтобы держать
	 * её отдельно от порядка блоков страницы.
	 *
	 * Порядок блоков здесь и есть содержание страницы: сначала герой, потом
	 * «продолжить просмотр» (у человека с недосмотренным фильмом намерение уже
	 * есть), потом подбор для тех, кто не знает, чего хочет, и только затем ряды.
	 */

	import ContinueRow from '$lib/components/ContinueRow.svelte';
	import HomeHero from '$lib/components/HomeHero.svelte';
	import MediaRow from '$lib/components/MediaRow.svelte';
	import Chip from '$lib/components/ui/Chip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { reveal } from '$lib/reveal';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>КИНЕМА — фильмы и сериалы онлайн</title>
	<meta
		name="description"
		content="Каталог фильмов и сериалов с подбором по настроению, выбором озвучки, субтитрами и продолжением просмотра."
	/>
</svelte:head>

<main>
	<HomeHero slides={data.hero} noPlaybackSource={data.noPlaybackSource} />

	<div class="relative mx-auto max-w-[var(--page-max)]">
		<!--
			«Продолжить просмотр» стоит первым и выше подбора: у человека с
			недосмотренным фильмом намерение уже есть, ему не нужно ничего
			предлагать. Ряд появляется только если есть что продолжать, поэтому у
			нового пользователя первым по-прежнему идёт подбор.
		-->
		<div class="pt-9 md:pt-11">
			<ContinueRow />
		</div>

		<!-- Вход в подбор. Стоит выше рядов намеренно: человек, который не знает,
		     что смотреть, не должен сначала прокрутить девять подборок. -->
		<section class="px-[var(--gutter)] py-9 md:py-11" use:reveal>
			<a
				href="/picker"
				class="group relative flex items-center gap-5 overflow-hidden rounded-lg border
				       border-line-soft bg-surface/50 p-5 transition hover:border-line-strong md:p-7"
			>
				<div class="aurora opacity-70" aria-hidden="true"></div>

				<span
					class="relative grid h-14 w-14 shrink-0 place-items-center rounded-md border border-line
					       bg-canvas/60 text-accent transition group-hover:scale-105 md:h-16 md:w-16"
					style="box-shadow: var(--glow-sm)"
				>
					<Icon name="dice" size={28} />
				</span>

				<div class="relative min-w-0 flex-1">
					<h2 class="mb-1 text-[15px] font-semibold tracking-tight text-ink sm:text-[17px] md:text-xl
					       tv:text-2xl">
						Не знаете, что смотреть?
					</h2>
					<p class="text-[12px] leading-relaxed text-dim sm:text-[13px] tv:text-lg">
						Пять вопросов о настроении, времени и планке качества — и конкретный ответ вместо
						бесконечной прокрутки.
					</p>
				</div>

				<span
					class="relative hidden shrink-0 items-center gap-1.5 text-sm text-accent transition
					       group-hover:gap-2.5 sm:flex"
				>
					Подобрать
					<Icon name="chevronRight" size={16} />
				</span>
			</a>
		</section>

		<!-- Фильтр по сетям -->
		<div class="mb-8 flex flex-wrap items-center gap-2 px-[var(--gutter)]">
			<span class="eyebrow mr-1">Смотреть на</span>
			<!--
				data-sveltekit-noscroll обязателен: без него переход по ссылке сбрасывает
				прокрутку наверх, и после выбора сети пользователь оказывался в начале
				страницы вместо ряда, который он смотрел.
			-->
			<Chip href="/" active={data.activeNetwork === null} size="sm" noscroll>Все</Chip>
			{#each data.networks as net (net.id)}
				<Chip
					href="/?network={net.id}"
					active={data.activeNetwork === net.id}
					size="sm"
					noscroll
				>
					{net.name}
				</Chip>
			{/each}
		</div>

		<div class="space-y-11 pb-4 md:space-y-14">
			{#each data.rows as row, i (row.id)}
				<!--
					use:reveal вешаем на обёртку, а не на сам ряд: действие добавляет
					классы элементу, а секцию рисует компонент. Первый ряд не
					анимируем — он часто попадает на первый экран, и «выезд» того, что
					пользователь уже видит, читается как подтормаживание.
				-->
				<div use:reveal={i === 0 ? undefined : {}}>
					<MediaRow
						title={row.title}
						items={row.items}
						href={row.href}
						ranked={row.ranked}
						eager={i === 0}
					/>
				</div>
			{/each}
		</div>
	</div>
</main>
