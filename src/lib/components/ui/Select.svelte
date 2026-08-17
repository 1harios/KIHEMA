<script lang="ts">
	/**
	 * Выпадающий список в стиле сайта.
	 *
	 * Зачем свой вместо нативного `<select>`: нативный рисуется виджетом
	 * операционной системы. На тёмной теме он открывается белым системным меню с
	 * чужими шрифтами и радиусами — единственный элемент интерфейса, который
	 * невозможно оформить. Для каталога, где сортировка стоит рядом с фильтрами,
	 * это выглядело как чужая деталь.
	 *
	 * Взамен приходится самому отвечать за доступность, поэтому здесь есть роли
	 * listbox/option, aria-activedescendant, стрелки, Home/End, Enter, Escape и
	 * закрытие по клику мимо. Без этого замена нативного контрола — ухудшение.
	 */

	import Icon, { type IconName } from './Icon.svelte';

	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		options: readonly Option[];
		value: string;
		/** Подпись для скринридера: «Сортировка», «Регион» и т. п. */
		label: string;
		icon?: IconName;
		onselect: (value: string) => void;
	}

	let { options, value, label, icon = 'sliders', onselect }: Props = $props();

	let open = $state(false);
	let activeIndex = $state(0);
	let root: HTMLDivElement | null = $state(null);
	let button: HTMLButtonElement | null = $state(null);

	const selectedIndex = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
	const current = $derived(options[selectedIndex]);

	/**
	 * Направление сортировки читается из суффикса значения TMDB (`.asc` / `.desc`).
	 * Стрелка рядом с подписью экономит пользователю чтение: «Сначала новые» и
	 * «Сначала старые» отличаются одним словом в конце.
	 */
	const dirIcon = $derived<IconName | null>(
		value.endsWith('.asc') ? 'chevronUp' : value.endsWith('.desc') ? 'chevronDown' : null
	);

	function openMenu() {
		activeIndex = selectedIndex;
		open = true;
	}

	function closeMenu(returnFocus = true) {
		open = false;
		if (returnFocus) button?.focus();
	}

	function choose(index: number) {
		const opt = options[index];
		closeMenu();
		if (opt && opt.value !== value) onselect(opt.value);
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openMenu();
			}
			return;
		}

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				closeMenu();
				break;
			case 'ArrowDown':
				e.preventDefault();
				activeIndex = (activeIndex + 1) % options.length;
				break;
			case 'ArrowUp':
				e.preventDefault();
				activeIndex = (activeIndex - 1 + options.length) % options.length;
				break;
			case 'Home':
				e.preventDefault();
				activeIndex = 0;
				break;
			case 'End':
				e.preventDefault();
				activeIndex = options.length - 1;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				choose(activeIndex);
				break;
		}
	}

	/** Клик мимо. Слушаем на документе, а не оверлеем: оверлей ломает прокрутку. */
	$effect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) closeMenu(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	const listId = `sel-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div bind:this={root} class="relative">
	<button
		bind:this={button}
		type="button"
		onclick={() => (open ? closeMenu(false) : openMenu())}
		onkeydown={onKeydown}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label="{label}: {current?.label ?? ''}"
		class="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs transition
		       tv:h-12 tv:px-5 tv:text-base {open
			? 'border-line-strong bg-surface-2 text-ink'
			: 'border-line text-dim hover:border-line-strong hover:text-ink'}"
	>
		<Icon name={icon} size={15} class="shrink-0" />
		<span class="whitespace-nowrap">{current?.label}</span>
		{#if dirIcon}
			<Icon name={dirIcon} size={13} class="shrink-0 text-faint" />
		{/if}
	</button>

	{#if open}
		<ul
			id={listId}
			role="listbox"
			aria-label={label}
			aria-activedescendant="{listId}-{activeIndex}"
			tabindex="-1"
			onkeydown={onKeydown}
			class="absolute left-0 top-full z-50 mt-2 max-h-[70vh] min-w-52 overflow-auto rounded-md
			       border border-line bg-elev py-1.5 shadow-4"
		>
			{#each options as opt, i (opt.value)}
				<li
					id="{listId}-{i}"
					role="option"
					aria-selected={opt.value === value}
				>
					<button
						type="button"
						tabindex="-1"
						onclick={() => choose(i)}
						onmouseenter={() => (activeIndex = i)}
						class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition
						       tv:py-3 tv:text-base {i === activeIndex ? 'bg-surface' : ''}
						       {opt.value === value ? 'text-accent' : 'text-dim'}"
					>
						<span class="flex-1 whitespace-nowrap">{opt.label}</span>
						{#if opt.value === value}
							<Icon name="check" size={15} class="shrink-0" />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
