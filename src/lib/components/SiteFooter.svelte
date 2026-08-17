<script lang="ts">
	/**
	 * Подвал.
	 *
	 * Здесь не только навигация. Два блока обязательны по условиям использования
	 * API и раньше их не было вообще:
	 *
	 * 1. TMDB требует дословную формулировку «This product uses the TMDB API but is
	 *    not endorsed or certified by TMDB» и свой логотип, менее заметный, чем наш.
	 * 2. Данные о том, где смотреть, приходят от JustWatch, и его атрибуция —
	 *    отдельное требование: за его отсутствие отзывают доступ.
	 *
	 * Это не юридическая вежливость, а условие работы ключа.
	 */

	import Logo from './ui/Logo.svelte';

	const year = new Date().getFullYear();

	const SECTIONS = [
		{
			title: 'Каталог',
			links: [
				{ href: '/catalog/movies', label: 'Фильмы' },
				{ href: '/catalog/shows', label: 'Сериалы' },
				{ href: '/catalog/movies?sort=vote_average.desc', label: 'Высокий рейтинг' },
				{ href: '/catalog/movies?sort=primary_release_date.desc', label: 'Новинки' }
			]
		},
		{
			title: 'Найти',
			links: [
				{ href: '/picker', label: 'Подбор фильма' },
				{ href: '/search', label: 'Поиск' },
				{ href: '/lists', label: 'Смотреть позже' },
				{ href: '/lists?kind=favorite', label: 'Избранное' }
			]
		}
	];
</script>

<footer class="relative mt-20 border-t border-line-soft">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-[var(--page-max)] px-[var(--gutter)] py-12">
		<div class="flex flex-col gap-10 lg:flex-row lg:justify-between">
			<div class="max-w-xs">
				<Logo size={28} class="mb-4" />
				<p class="text-[13px] leading-relaxed text-dim">
					Каталог фильмов и сериалов с выбором озвучки, субтитрами и продолжением просмотра.
					Метаданные — TMDB, воспроизведение — ваша медиатека.
				</p>
			</div>

			<div class="flex gap-12 sm:gap-20">
				{#each SECTIONS as section (section.title)}
					<nav aria-label={section.title}>
						<h2 class="eyebrow mb-3.5">{section.title}</h2>
						<ul class="space-y-2.5">
							{#each section.links as link (link.href)}
								<li>
									<a
										href={link.href}
										class="text-[13px] text-dim transition hover:text-accent"
									>
										{link.label}
									</a>
								</li>
							{/each}
						</ul>
					</nav>
				{/each}
			</div>
		</div>

		<!-- Атрибуция. Логотип TMDB — тонкой заливкой и мелко: по их правилам он
		     должен быть менее заметным, чем наш собственный знак. -->
		<div class="mt-12 flex flex-col gap-5 border-t border-line-soft pt-7 text-[11px] text-faint">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-4">
				<a
					href="https://www.themoviedb.org"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-2.5 transition hover:text-dim"
					aria-label="The Movie Database"
				>
					<!-- Официальная форма знака TMDB: скруглённый прямоугольник и монограмма. -->
					<svg viewBox="0 0 60 20" width="54" height="18" aria-hidden="true" class="shrink-0">
						<rect width="60" height="20" rx="3" fill="currentColor" opacity="0.14" />
						<text
							x="30"
							y="14.2"
							text-anchor="middle"
							font-family="Inter Tight, system-ui, sans-serif"
							font-size="10.5"
							font-weight="700"
							letter-spacing="0.08em"
							fill="currentColor"
						>
							TMDB
						</text>
					</svg>
					<span class="max-w-[24rem] leading-relaxed">
						This product uses the TMDB API but is not endorsed or certified by TMDB.
					</span>
				</a>

				<span class="leading-relaxed">
					Данные о доступности на стримингах — <a
						href="https://www.justwatch.com"
						target="_blank"
						rel="noopener noreferrer"
						class="underline decoration-line-strong underline-offset-2 transition hover:text-dim"
						>JustWatch</a
					>.
				</span>
			</div>

			<p class="text-faint/70">
				© {year} КИНЕМА. Личный проект, не связанный с TMDB, JustWatch и правообладателями.
			</p>
		</div>
	</div>
</footer>
