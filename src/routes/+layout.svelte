<script lang="ts">
	import '../app.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { keyHelp, registerKeys } from '$lib/keys.svelte';
	import { preview } from '$lib/preview.svelte';
	import { initLists } from '$lib/lists.svelte';
	import { progress } from '$lib/progress.svelte';
	import { installSpatialNav } from '$lib/spatial.svelte';
	import AppRail from '$lib/components/AppRail.svelte';
	import HotkeyHelp from '$lib/components/HotkeyHelp.svelte';
	import HoverPreview from '$lib/components/HoverPreview.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { Theme } from '$lib/types';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Плавные переходы включаем только после гидрации, иначе моргает на первой
	// отрисовке. Списки читаем из localStorage там же — до гидрации их нет.
	$effect(() => {
		document.documentElement.classList.add('theme-ready');
		initLists();
		// Прогресс просмотра тоже лежит в localStorage — читаем здесь же, иначе
		// карточки на первой отрисовке не знают, что тайтл начат.
		progress.init();
		// Навигация стрелками включается сама и только на телевизорах — см. spatial.
		return installSpatialNav();
	});

	/**
	 * На странице плеера нет ни рельса, ни шапки, ни подвала: видео занимает весь
	 * кадр, любая рамка вокруг него мешает.
	 */
	const isWatch = $derived(page.url.pathname.endsWith('/watch'));

	/**
	 * Баннер режима. Остался ровно один случай — демо без ключа TMDB: там сайт
	 * показывает встроенные данные вместо каталога, и об этом нужно сказать.
	 *
	 * Полосу про неподключённый источник воспроизведения убрали по требованию.
	 * Она объясняла, почему у тайтлов стоит «Нет в медиатеке», но висела на каждой
	 * странице постоянно, а объяснение это одноразовое: прочитал — и дальше оно
	 * только занимает первый экран. Причина при этом не потерялась: она осталась в
	 * подсказке у самой недоступной кнопки, то есть ровно там, где вопрос и
	 * возникает.
	 */
	const notice = $derived(
		data.demoMode
			? 'Демо-режим: данные встроенные. Укажите TMDB_API_KEY в .env, чтобы увидеть настоящий каталог.'
			: null
	);

	/**
	 * Панель описания не должна переживать переход между страницами.
	 *
	 * Иначе получается то, на что жаловались: нажали карточку, ушли на страницу
	 * фильма, а отложенное открытие срабатывает уже там — панель появляется поверх
	 * страницы тайтла по координатам карточки, которой на экране нет.
	 */
	afterNavigate(() => preview.reset());

	/**
	 * Горячие клавиши сайта.
	 *
	 * Приоритет ноль: это самый нижний слой. Любая панель, просмотрщик или плеер
	 * регистрируются выше и перехватывают клавишу раньше — поэтому Escape в
	 * просмотрщике не долетает сюда, а стрелки в галерее не листают герой.
	 *
	 * Переходы сделаны последовательностью с префиксом g, как в GitHub и Gmail.
	 * Одиночные буквы отданы плееру и полям: занять «m» под «фильмы» означало бы
	 * отобрать её у отключения звука, а это куда более частое действие.
	 */
	$effect(() =>
		registerKeys({
			id: 'site',
			priority: 0,
			bindings: [
				{
					combos: ['?'],
					hint: '?',
					title: 'Показать горячие клавиши',
					group: 'Общее',
					run: () => keyHelp.toggle()
				},
				{
					combos: ['g h'],
					hint: 'G затем H',
					title: 'На главную',
					group: 'Навигация',
					run: () => void goto('/')
				},
				{
					combos: ['g m'],
					hint: 'G затем M',
					title: 'Фильмы',
					group: 'Навигация',
					run: () => void goto('/catalog/movies')
				},
				{
					combos: ['g s'],
					hint: 'G затем S',
					title: 'Сериалы',
					group: 'Навигация',
					run: () => void goto('/catalog/shows')
				},
				{
					combos: ['g p'],
					hint: 'G затем P',
					title: 'Подбор фильма',
					group: 'Навигация',
					run: () => void goto('/picker')
				},
				{
					combos: ['g l'],
					hint: 'G затем L',
					title: 'Мои списки',
					group: 'Навигация',
					run: () => void goto('/lists')
				}
			]
		})
	);

	/**
	 * Высота полосы уведомления в переменную --notice-h.
	 *
	 * Нужна из-за героя главной: он занимает первый экран целиком, то есть
	 * 100dvh минус шапка. Но когда над ним висит полоса режима, она сдвигает
	 * герой вниз, и его нижний край — вместе с кнопками — уходит за сгиб. Высота
	 * полосы зависит от длины текста и ширины экрана, поэтому в CSS её не
	 * посчитать: приходится измерять.
	 *
	 * Наблюдатель, а не одно измерение: на повороте телефона текст
	 * перекомпоновывается с двух строк на три.
	 */
	let noticeEl: HTMLElement | null = $state(null);

	$effect(() => {
		const root = document.documentElement;
		if (!noticeEl) {
			root.style.removeProperty('--notice-h');
			return;
		}
		const el = noticeEl;
		const apply = () => root.style.setProperty('--notice-h', `${el.offsetHeight}px`);
		apply();
		const ro = new ResizeObserver(apply);
		ro.observe(el);
		return () => {
			ro.disconnect();
			root.style.removeProperty('--notice-h');
		};
	});
</script>

<div class="grain min-h-dvh bg-canvas">
	{#if isWatch}
		{@render children()}
	{:else}
		<AppRail user={data.user} theme={(data.theme ?? 'default') as Theme} />

		<!--
			Сдвиг под рельс задаётся переменной, а не константой: ширина рельса
			живёт в app.css, и «липкие» блоки внутри страниц считают её оттуда же.
			Отступ снизу на мобильном — под таб-бар.
		-->
		<div class="pb-[calc(var(--tabbar-h)+1rem)] md:pl-[var(--rail-w)]">
			{#if notice}
				<div
					bind:this={noticeEl}
					class="flex items-start gap-2.5 border-b border-line-soft bg-surface/60
					       px-[var(--gutter)] py-2.5 text-[11.5px] leading-relaxed text-dim"
					role="status"
				>
					<span class="mt-px shrink-0 text-faint"><Icon name="info" size={14} /></span>
					<p>{notice}</p>
				</div>
			{/if}

			{@render children()}

			<SiteFooter />
		</div>
	{/if}

	<!--
		Панель с описанием карточки — одна на всю страницу. В рядах и сетках
		карточек до двухсот, и держать по панели у каждой было бы дороже всего
		остального на экране.
	-->
	<HoverPreview />

	<!-- Панель подсказки одна на весь сайт и вне ветки плеера: на странице
	     просмотра рельса нет, а список клавиш нужен именно там. -->
	<HotkeyHelp />
</div>
