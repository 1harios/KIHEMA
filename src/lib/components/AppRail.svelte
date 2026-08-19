<script lang="ts">
	/**
	 * Левый рельс навигации + поисковая шапка.
	 *
	 * Почему рельс, а не горизонтальное меню: разделы каталога — это постоянная
	 * навигация, к которой возвращаются после каждого тайтла. В шапке она делит
	 * место с поиском и уезжает под гамбургер на планшете. В рельсе она всегда
	 * на месте и стоит 4.5rem, которые всё равно нужны как воздух слева.
	 *
	 * На мобильном рельс превращается в нижний таб-бар: 4.5rem слева при ширине
	 * 360px — это 12% экрана под иконки, что для сетки постеров непозволительно.
	 */

	import { registerKeys } from '$lib/keys.svelte';
	import { page } from '$app/state';
	import { lists } from '$lib/lists.svelte';
	import { THEME_LABELS, THEME_SWATCH, THEMES, type Theme } from '$lib/types';
	import Icon, { type IconName } from './ui/Icon.svelte';
	import Logo from './ui/Logo.svelte';
	import SearchBox from './SearchBox.svelte';

	interface Props {
		user?: { name: string } | null;
		theme: Theme;
	}

	let { user, theme: initialTheme }: Props = $props();

	/**
	 * Тема приезжает с сервера пропом, но переключается локально. Прямое
	 * $state(initialTheme) захватило бы только первое значение и разошлось с
	 * сервером при навигации, поэтому храним отдельно только осознанный выбор
	 * пользователя, а базой остаётся проп.
	 */
	let picked = $state<Theme | null>(null);
	const theme = $derived(picked ?? initialTheme);
	let themeOpen = $state(false);
	const NAV: { href: string; icon: IconName; label: string }[] = [
		{ href: '/', icon: 'home', label: 'Главная' },
		{ href: '/catalog/movies', icon: 'film', label: 'Фильмы' },
		{ href: '/catalog/shows', icon: 'tv', label: 'Сериалы' },
		{ href: '/picker', icon: 'dice', label: 'Подбор' },
		{ href: '/lists', icon: 'bookmark', label: 'Моё' }
	];

	/** Точное совпадение для главной, иначе по префиксу — /movie/… не подсвечивает. */
	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

	const savedCount = $derived(lists.count('later') + lists.count('favorite'));

	async function applyTheme(next: Theme) {
		picked = next;
		themeOpen = false;

		const root = document.documentElement;
		for (const t of THEMES) root.classList.remove(`theme-${t}`);
		if (next !== 'default') root.classList.add(`theme-${next}`);

		await fetch('/theme', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ theme: next })
		});
	}

	/** Фокус по «/» перехватывает SearchBox — здесь остаётся только меню тем. */
	/**
	 * Escape закрывает выбор темы. Регистрируется только пока меню открыто —
	 * иначе рельс перехватывал бы Escape всегда и закрывал бы заодно чужие слои.
	 */
	$effect(() => {
		if (!themeOpen) return;
		return registerKeys({
			id: 'theme-menu',
			priority: 60,
			bindings: [
				{
					combos: ['Escape'],
					hint: 'Esc',
					title: 'Закрыть выбор темы',
					group: 'Общее',
					hidden: true,
					run: () => (themeOpen = false)
				}
			]
		});
	});
</script>

<!-- ============================ рельс (>= md) ============================ -->
<nav
	class="glass fixed inset-y-0 left-0 z-50 hidden w-[var(--rail-w)] flex-col items-center
	       border-r border-line-soft py-4 md:flex"
	aria-label="Основная навигация"
>
	<a
		href="/"
		class="mb-6 grid h-11 w-11 place-items-center rounded-md transition hover:bg-surface"
		aria-label="КИНЕМА — на главную"
	>
		<Logo markOnly size={25} />
	</a>

	<ul class="flex flex-1 flex-col items-center gap-1.5">
		{#each NAV as link (link.href)}
			{@const active = isActive(link.href)}
			<li class="relative">
				<a
					href={link.href}
					class="group/nav relative grid h-11 w-11 place-items-center rounded-md transition
					       tv:h-16 tv:w-16
					       {active ? 'text-accent' : 'text-faint hover:bg-surface hover:text-ink'}"
					aria-label={link.label}
					aria-current={active ? 'page' : undefined}
				>
					{#if active}
						<!-- Активный раздел: засветка + риска у кромки. Одной заливки в
						     монохроме мало — она не отличается от hover. -->
						<span
							class="absolute inset-0 rounded-md bg-accent-soft"
							style="box-shadow: var(--glow-sm)"
						></span>
						<!--
							Риска у кромки рельса. Смещение считается от ширины рельса, а не
							константой: на ТВ рельс шире, и жёсткий -left-4 отрывал риску от
							края, оставляя её висеть в пустоте посередине.
						-->
						<span
							class="absolute top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent
							       tv:h-9"
							style="left: calc(-1 * ((var(--rail-w) - 2.75rem) / 2))"
						></span>
					{/if}
					<Icon name={link.icon} size={21} class="relative" />

					<!-- Подпись по наведению: иконки без текста угадываются не всегда -->
					<span
						class="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap
						       rounded-sm border border-line bg-elev px-2.5 py-1.5 text-xs text-ink
						       opacity-0 shadow-3 transition group-hover/nav:opacity-100 lg:block"
					>
						{link.label}
					</span>
				</a>

				{#if link.href === '/lists' && savedCount > 0}
					<span
						class="tnum pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4
						       place-items-center rounded-full bg-accent px-1 text-[9px] font-bold
						       text-accent-ink"
						aria-label="{savedCount} в списках"
					>
						{savedCount > 99 ? '99+' : savedCount}
					</span>
				{/if}
			</li>
		{/each}
	</ul>

	<!-- низ рельса: тема и профиль -->
	<div class="flex flex-col items-center gap-1.5">
		<div class="relative">
			<button
				type="button"
				onclick={() => (themeOpen = !themeOpen)}
				aria-label="Оформление"
				aria-expanded={themeOpen}
				class="grid h-11 w-11 place-items-center rounded-md text-faint transition
				       hover:bg-surface hover:text-ink"
			>
				<Icon name="palette" size={20} />
			</button>

			{#if themeOpen}
				<button
					type="button"
					class="fixed inset-0 z-40 cursor-default"
					onclick={() => (themeOpen = false)}
					aria-label="Закрыть меню оформления"
					tabindex="-1"
				></button>
				<div
					class="absolute bottom-0 left-full z-50 ml-3 w-52 overflow-hidden rounded-md
					       border border-line bg-elev py-1.5 shadow-4"
					role="menu"
				>
					<p class="eyebrow px-3 pb-1.5 pt-1">Оформление</p>
					{#each THEMES as t (t)}
						<button
							type="button"
							role="menuitemradio"
							aria-checked={theme === t}
							onclick={() => applyTheme(t)}
							class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition
							       hover:bg-surface {theme === t ? 'text-accent' : 'text-dim'}"
						>
							<span
								class="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/20"
								style="background: {THEME_SWATCH[t]}"
							></span>
							{THEME_LABELS[t]}
							{#if theme === t}
								<Icon name="check" size={15} class="ml-auto" />
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		{#if user}
			<div
				class="grid h-9 w-9 place-items-center rounded-full bg-accent text-[13px] font-bold
				       text-accent-ink"
				title={user.name}
			>
				{user.name.charAt(0).toUpperCase()}
			</div>
		{:else}
			<a
				href="/login"
				class="grid h-11 w-11 place-items-center rounded-md text-faint transition
				       hover:bg-surface hover:text-ink"
				aria-label="Войти"
			>
				<Icon name="login" size={20} />
			</a>
		{/if}
	</div>
</nav>

<!-- ======================= верхняя полоса с поиском ====================== -->
<header
	class="glass sticky top-0 z-40 border-b border-line-soft"
	style="padding-left: 0; padding-right: 0"
>
	<div class="mx-auto flex h-14 max-w-[var(--page-max)] items-center gap-3 px-[var(--gutter)] md:h-16">
		<!-- Полная надпись остаётся в шапке и на ПК; рельс использует компактный знак. -->
		<a href="/" class="shrink-0" aria-label="КИНЕМА — на главную">
			<Logo size={24} />
		</a>

		<div class="ml-auto w-full max-w-md">
			<SearchBox />
		</div>
	</div>
</header>

<!-- ========================= таб-бар (< md) ============================= -->
<nav
	class="glass fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-line-soft
	       pb-[env(safe-area-inset-bottom)] md:hidden"
	aria-label="Основная навигация"
>
	{#each NAV as link (link.href)}
		{@const active = isActive(link.href)}
		<a
			href={link.href}
			class="relative flex flex-col items-center gap-1 py-2.5 text-[10px] transition
			       {active ? 'text-accent' : 'text-faint'}"
			aria-current={active ? 'page' : undefined}
		>
			{#if active}
				<span class="absolute inset-x-4 top-0 h-[2px] rounded-b-full bg-accent"></span>
			{/if}
			<Icon name={link.icon} size={20} />
			{link.label}
			{#if link.href === '/lists' && savedCount > 0}
				<span
					class="tnum absolute right-[22%] top-1.5 grid h-3.5 min-w-3.5 place-items-center
					       rounded-full bg-accent px-1 text-[8px] font-bold text-accent-ink"
				>
					{savedCount > 99 ? '99+' : savedCount}
				</span>
			{/if}
		</a>
	{/each}
</nav>
