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
				class="group relative flex min-h-[13.25rem] items-end overflow-hidden rounded-lg border
				       border-line-soft bg-surface/50 p-5 pt-24 transition duration-[var(--t-slow)]
				       ease-[var(--ease-smooth)]
				       hover:border-line-strong sm:min-h-[15rem] sm:items-center sm:p-6 md:p-7"
			>
				<img
					src="/images/picker-banner-v2.png"
					alt=""
					class="absolute inset-0 h-full w-full object-cover object-[64%_42%] opacity-100 transition
					       duration-[var(--t-slower)] ease-[var(--ease-smooth)]
					       group-hover:scale-[1.006] sm:object-[72%_55%] sm:opacity-90 group-hover:opacity-100"
				/>
				<div
					class="absolute inset-0 bg-gradient-to-t from-[#07090d] via-[#07090d]/82 to-[#07090d]/10
					       sm:bg-gradient-to-r sm:from-[#07090d] sm:via-[#07090d]/85 sm:to-transparent"
					aria-hidden="true"
				></div>
				<div
					class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/10 sm:from-black/35 sm:to-black/5"
					aria-hidden="true"
				></div>

				<div class="relative z-10 min-w-0 sm:max-w-[72%] lg:max-w-[58%]">
					<span
						class="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase
						       tracking-[0.16em] text-white/60 sm:text-[11px]"
					>
						<Icon name="dice" size={13} />
						Подбор по настроению
					</span>
					<h2 class="mb-1.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl md:text-[28px]">
						Не знаете, что смотреть?
					</h2>
					<p class="max-w-3xl text-[12px] leading-relaxed text-white/65 sm:text-sm">
						Ответьте на пять вопросов — и получите фильм под настроение, время и нужное качество.
					</p>

					<span
						class="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4.5 text-[13px]
						       font-semibold text-accent-ink transition group-hover:bg-accent-hover"
						style="box-shadow: var(--glow-sm)"
					>
						Подобрать фильм
						<Icon name="chevronRight" size={15} />
					</span>
				</div>
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
