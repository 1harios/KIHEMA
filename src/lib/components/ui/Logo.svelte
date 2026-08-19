<script lang="ts">
	/** Логотип КИНЕМА и компактный знак на основе центральной буквы Н. */
	interface Props {
		/** Только знак — для рельса и компактных поверхностей. */
		markOnly?: boolean;
		size?: number;
		class?: string;
	}

	let { markOnly = false, size = 26, class: cls = '' }: Props = $props();

</script>

<span class="inline-flex items-center text-accent {cls}">
	{#if markOnly}
		<svg
			viewBox="0 0 32 32"
			width={size}
			height={size}
			class="shrink-0"
			aria-hidden="true"
			focusable="false"
		>
			<!-- Центральная Н из фирменной надписи: экран и две монтажные прорези. -->
			<path
				fill="currentColor"
				fill-rule="evenodd"
				d="M5 4h22v24H5V4Zm8 0h6v3c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V4Zm-.5 7h7c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-7c-.83 0-1.5-.67-1.5-1.5v-7c0-.83.67-1.5 1.5-1.5ZM13 28h6v-3c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3Z"
			/>
		</svg>
	{:else}
		<!-- Screen делает чёрный фон исходника визуально прозрачным, не трогая
		     геометрию и сглаживание утверждённой надписи. -->
		<span
			class="brand-wordmark block shrink-0"
			style="--logo-size: {size}px"
			aria-hidden="true"
		></span>
		<span class="sr-only">КИНЕМА</span>
	{/if}
</span>

<style>
	.brand-wordmark {
		width: calc(var(--logo-size) * 5.8);
		height: var(--logo-size);
		background: url('/images/kihema-wordmark-v2.png') center / 138% auto no-repeat;
		mix-blend-mode: screen;
	}
</style>
