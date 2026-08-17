<script lang="ts">
	/**
	 * Панель со списком горячих клавиш.
	 *
	 * Список не написан руками, а собран из реестра: показываются ровно те
	 * привязки, которые сейчас действуют. Поэтому на странице просмотра здесь
	 * будут клавиши плеера, а в галерее — клавиши просмотрщика, и панель не может
	 * рассказать о том, чего нет.
	 */

	import { keyHelp, keyRegistry, registerKeys } from '$lib/keys.svelte';
	import Icon from './ui/Icon.svelte';

	const groups = $derived(keyRegistry.groups);

	let dialog: HTMLElement | null = $state(null);
	let restoreTo: HTMLElement | null = null;

	// Escape в самом верхнем слое: приоритет выше модальных, потому что панель
	// подсказки открывается поверх всего остального.
	$effect(() => {
		if (!keyHelp.open) return;
		return registerKeys({
			id: 'hotkey-help',
			priority: 200,
			bindings: [
				{
					combos: ['Escape'],
					hint: 'Esc',
					title: 'Закрыть подсказку',
					group: 'Общее',
					hidden: true,
					run: () => keyHelp.close()
				}
			]
		});
	});

	// Фокус внутрь панели и обратно при закрытии: без возврата клавиатура после
	// закрытия оказывается в начале документа.
	$effect(() => {
		if (!keyHelp.open) return;
		restoreTo = document.activeElement as HTMLElement | null;
		dialog?.focus();
		const html = document.documentElement;
		const prev = html.style.overflow;
		html.style.overflow = 'hidden';
		return () => {
			html.style.overflow = prev;
			restoreTo?.focus?.();
		};
	});
</script>

{#if keyHelp.open}
	<!-- Затемнение кнопкой, а не div: закрытие нажатием мимо должно работать и с
	     клавиатуры. -->
	<button
		type="button"
		class="fixed inset-0 z-[190] bg-black/75 backdrop-blur-sm"
		onclick={() => keyHelp.close()}
		aria-label="Закрыть подсказку"
	></button>

	<div
		bind:this={dialog}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label="Горячие клавиши"
		class="fixed left-1/2 top-1/2 z-[191] max-h-[86dvh] w-[min(46rem,92vw)] -translate-x-1/2
		       -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-elev p-6
		       shadow-4 md:p-8"
	>
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<h2 class="font-display text-xl text-ink md:text-2xl">Горячие клавиши</h2>
				<p class="mt-1 text-[12px] text-dim">
					Список зависит от страницы: в плеере и в галерее набор свой.
				</p>
			</div>
			<button
				type="button"
				onclick={() => keyHelp.close()}
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-dim transition
				       duration-[var(--t-fast)] hover:bg-surface hover:text-ink"
				aria-label="Закрыть"
			>
				<Icon name="close" size={18} />
			</button>
		</div>

		<div class="grid gap-x-10 gap-y-7 sm:grid-cols-2">
			{#each groups as g (g.group)}
				<section>
					<p class="eyebrow mb-3">{g.group}</p>
					<dl class="space-y-2">
						{#each g.items as b (b.title)}
							<div class="flex items-baseline justify-between gap-4">
								<dt class="text-[13px] text-dim">{b.title}</dt>
								<dd
									class="shrink-0 rounded-sm border border-line-strong bg-surface px-2 py-0.5
									       font-mono text-[11px] text-ink"
								>
									{b.hint}
								</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	</div>
{/if}
