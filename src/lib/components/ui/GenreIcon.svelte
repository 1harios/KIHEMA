<script lang="ts">
	/**
	 * Оболочка для жанровых пиктограмм.
	 *
	 * Сам рисунок жанра остаётся штриховым, а вокруг него появляется общий для
	 * всей системы знак — «апертура»: тонкое кольцо и едва заметный ромб света.
	 * Так пиктограммы выглядят частью КИНЕМЫ, а не набором разрозненных SVG.
	 */
	import { genreIcon } from '$lib/genreIcons';
	import Icon from './Icon.svelte';

	type Variant = 'tile' | 'chip' | 'inline';

	interface Props {
		id: number;
		size?: number | string;
		variant?: Variant;
		class?: string;
	}

	let { id, size = 16, variant = 'inline', class: cls = '' }: Props = $props();
	const name = $derived(genreIcon(id));
</script>

<span class="genre-mark genre-mark--{variant} {cls}" aria-hidden="true">
	<Icon {name} {size} class="relative z-[1]" />
</span>

