<script lang="ts">
	/**
	 * Рейтинг дугой. Раньше это была цифра в чёрном прямоугольнике — цифра не
	 * даёт мгновенного «хорошо/плохо», дуга даёт: 7.9 и 5.2 отличаются не только
	 * значением, но и длиной заполнения.
	 *
	 * Дуга — conic-gradient с маской, не SVG: один элемент, без вложенных
	 * окружностей и без пересчёта stroke-dasharray.
	 */

	interface Props {
		value: number;
		/** Диаметр в пикселях. */
		size?: number;
		votes?: number;
		/** Компактный вид: только дуга, без числа. */
		bare?: boolean;
	}

	let { value, size = 44, votes, bare = false }: Props = $props();

	const pct = $derived(Math.max(0, Math.min(100, value * 10)));

	/**
	 * Цвет дуги.
	 *
	 * Зелёный здесь был ошибкой: в сетке из двадцати постеров это двадцать
	 * зелёных колец, и монохром рассыпается — а он тут основа. Хорошая оценка
	 * получает яркую платину (она и так читается как «хорошо» на тёмном фоне),
	 * средняя — приглушённый серый, слабая — единственную тёплую ноту в макете.
	 * Сигнал сохраняется, палитра — тоже.
	 */
	const tone = $derived(
		value >= 7 ? 'var(--c-accent)' : value >= 5.5 ? 'var(--c-text-dim)' : 'var(--c-warn)'
	);

	const label = $derived(
		votes
			? `Рейтинг ${value.toFixed(1)} из 10, ${votes} оценок`
			: `Рейтинг ${value.toFixed(1)} из 10`
	);

	const thickness = $derived(Math.max(2, Math.round(size * 0.075)));
</script>

<!--
	Без атрибута title.

	Дуга лежит в углу постера, и нативная подсказка выскакивала у курсора прямо
	поверх картинки, стоило подвести мышь к карточке. Само число видно и так, а
	расшифровка с количеством оценок осталась в aria-label — для скринридеров она
	и нужна, а глазами её читать негде.
-->
<div
	class="relative grid shrink-0 place-items-center"
	style="width: {size}px; height: {size}px"
	role="img"
	aria-label={label}
>
	<!-- Трек -->
	<div
		class="absolute inset-0 rounded-full"
		style="
			background: conic-gradient({tone} {pct}%, rgb(255 255 255 / 0.13) {pct}%);
			mask: radial-gradient(farthest-side, transparent calc(100% - {thickness}px), #000 calc(100% - {thickness}px));
			-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - {thickness}px), #000 calc(100% - {thickness}px));
		"
	></div>

	{#if !bare}
		<!-- Подложка под число: на светлых постерах без неё цифра тонет -->
		<div class="absolute inset-[3px] rounded-full bg-canvas/72 backdrop-blur-[2px]"></div>
		<span
			class="tnum relative font-semibold leading-none text-ink"
			style="font-size: {Math.round(size * 0.32)}px"
		>
			{value.toFixed(1)}
		</span>
	{/if}
</div>
