<script lang="ts">
	/**
	 * Знак и логотип КИНЕМА.
	 *
	 * Знак — кадр плёнки со световым лучом проектора. Читается на 20px: снаружи
	 * только скруглённый контур, внутри одна диагональ. Всё в currentColor, чтобы
	 * знак жил в любой теме без отдельных вариантов.
	 *
	 * Слово набирается display-гарнитурой с положительным трекингом — в капсах
	 * кириллица без разрядки выглядит сжатой.
	 */

	interface Props {
		/** Только знак — для рельса и мобильной шапки. */
		markOnly?: boolean;
		size?: number;
		class?: string;
	}

	let { markOnly = false, size = 26, class: cls = '' }: Props = $props();

	// Уникальный id клипа: два логотипа на странице с одним id ломают второй.
	const uid = `logo-${Math.random().toString(36).slice(2, 8)}`;
</script>

<span class="flex items-center gap-2.5 {cls}">
	<svg
		viewBox="0 0 32 32"
		width={size}
		height={size}
		class="shrink-0 text-accent"
		aria-hidden="true"
		focusable="false"
	>
		<defs>
			<clipPath id={uid}>
				<rect x="3" y="3" width="26" height="26" rx="8.5" />
			</clipPath>
		</defs>

		<g clip-path="url(#{uid})">
			<!-- Луч: две полосы разной плотности — так он читается как свет, а не
			     как декоративная диагональ. -->
			<path d="M -3 21 L 14 -3 L 25 -3 L 8 21 Z" fill="currentColor" opacity="0.5" />
			<path d="M 5 33 L 22 9 L 28 9 L 11 33 Z" fill="currentColor" opacity="0.15" />
		</g>

		<rect
			x="4.2"
			y="4.2"
			width="23.6"
			height="23.6"
			rx="7.4"
			fill="none"
			stroke="currentColor"
			stroke-width="2.3"
		/>
	</svg>

	{#if !markOnly}
		<span
			class="font-display text-[15px] font-semibold leading-none text-ink"
			style="letter-spacing: 0.13em"
		>
			КИНЕМА
		</span>
	{/if}
</span>
