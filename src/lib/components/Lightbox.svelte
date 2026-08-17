<script lang="ts">
	/**
	 * Просмотрщик картинок.
	 *
	 * Раньше кадр или постер открывался ссылкой в новой вкладке: человек уходил с
	 * сайта на голое изображение, листать там было нечего, а возвращался он
	 * кнопкой «назад». Здесь то же изображение открывается слоем поверх страницы,
	 * и галерею можно пройти целиком, не теряя места.
	 *
	 * Что здесь не декоративно:
	 *
	 * — Соседние картинки подгружаются заранее, по одной в каждую сторону. Без
	 *   этого каждое нажатие «вперёд» упирается в загрузку мегабайтного кадра, и
	 *   листание перестаёт быть листанием. Загружать всю галерею тоже нельзя: там
	 *   до сорока изображений.
	 *
	 * — Прокрутка страницы под слоем блокируется. Без этого на телефоне страница
	 *   уезжает под картинкой, и после закрытия человек оказывается не там, где
	 *   был.
	 *
	 * — Фокус уходит внутрь и возвращается на ту миниатюру, с которой открыли.
	 *   Иначе после закрытия табуляция начинается с начала документа.
	 *
	 * — Клавиши регистрируются в общем реестре с высоким приоритетом, поэтому
	 *   стрелки листают картинки, а не слайды героя под слоем, а Escape закрывает
	 *   только этот слой.
	 */

	import { registerKeys } from '$lib/keys.svelte';
	import Icon from './ui/Icon.svelte';

	export interface LightboxImage {
		/** Полный размер — то, что показываем. */
		full: string;
		/** Превью: показываем, пока грузится полный, чтобы не было пустоты. */
		thumb?: string;
		caption?: string;
	}

	interface Props {
		images: LightboxImage[];
		/** Индекс открытой картинки. null — просмотрщик закрыт. */
		index: number | null;
		onclose: () => void;
		onindex: (i: number) => void;
		/** Подпись группы: «Кадры», «Постеры», «Фотографии». */
		label?: string;
	}

	let { images, index, onclose, onindex, label = 'Изображение' }: Props = $props();

	const open = $derived(index !== null && index >= 0 && index < images.length);
	const current = $derived(open ? images[index as number] : null);

	let dialog: HTMLElement | null = $state(null);
	let restoreTo: HTMLElement | null = null;
	/** Полный файл текущей картинки уже в кэше браузера. */
	let loaded = $state(false);

	function step(delta: number) {
		if (index === null || !images.length) return;
		// По кругу: на последней картинке «вперёд» ведёт к первой. Тупик в конце
		// галереи выглядит как поломка кнопки.
		const next = (index + delta + images.length) % images.length;
		onindex(next);
	}

	/** Ссылка на текущую картинку — чтобы спросить у неё, загрузилась ли она. */
	let imgEl: HTMLImageElement | null = $state(null);

	/**
	 * Готовность картинки.
	 *
	 * Полагаться на одно событие load нельзя, и это была настоящая поломка:
	 * когда файл уже в кэше браузера, load успевает произойти до того, как
	 * навесится обработчик, — и «загрузилось» не наступает никогда. Размытая
	 * заглушка при этом остаётся висеть поверх, а сама картинка держит нулевую
	 * прозрачность: выглядит так, будто фотография целиком мыльная.
	 *
	 * Поэтому состояние сбрасывается на смене картинки и сразу же проверяется по
	 * свойству complete, а событие остаётся только для тех, что грузятся впервые.
	 */
	$effect(() => {
		if (index === null) return;
		loaded = false;
		// Картинка могла быть в кэше: complete истинно ещё до первого кадра.
		if (imgEl?.complete && imgEl.naturalWidth > 0) loaded = true;

		// Предзагрузка соседей: ровно по одной в каждую сторону. Всю галерею
		// тянуть нельзя — там до сорока файлов в полном размере.
		for (const d of [1, -1]) {
			const n = images[(index + d + images.length) % images.length];
			if (!n) continue;
			const img = new Image();
			img.src = n.full;
		}
	});

	$effect(() => {
		if (!open) return;
		return registerKeys({
			id: 'lightbox',
			priority: 120,
			bindings: [
				{
					combos: ['ArrowRight', 'l'],
					hint: '→',
					title: 'Следующее изображение',
					group: 'Просмотр',
					run: () => step(1)
				},
				{
					combos: ['ArrowLeft', 'j'],
					hint: '←',
					title: 'Предыдущее изображение',
					group: 'Просмотр',
					run: () => step(-1)
				},
				{
					combos: ['Home'],
					hint: 'Home',
					title: 'Первое изображение',
					group: 'Просмотр',
					run: () => onindex(0)
				},
				{
					combos: ['End'],
					hint: 'End',
					title: 'Последнее изображение',
					group: 'Просмотр',
					run: () => onindex(images.length - 1)
				},
				{
					combos: ['Escape'],
					hint: 'Esc',
					title: 'Закрыть просмотр',
					group: 'Просмотр',
					run: () => onclose()
				}
			]
		});
	});

	// Блокировка прокрутки, фокус внутрь и возврат наружу.
	$effect(() => {
		if (!open) return;
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

	/* --------------------------------- свайп --------------------------------- */

	let touchX = 0;

	function onTouchStart(e: TouchEvent) {
		touchX = e.touches[0]?.clientX ?? 0;
	}

	function onTouchEnd(e: TouchEvent) {
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
		// 50px — тот же порог, что у карусели героя: меньше ловит случайные касания.
		if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
	}
</script>

{#if open && current}
	<div
		bind:this={dialog}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label="{label} {(index as number) + 1} из {images.length}"
		class="fixed inset-0 z-[150] flex flex-col bg-black/92 backdrop-blur-md"
		ontouchstart={onTouchStart}
		ontouchend={onTouchEnd}
	>
		<!-- Шапка: счётчик, ссылка на оригинал, закрытие. -->
		<div class="flex shrink-0 items-center justify-between gap-3 px-4 py-3 md:px-6">
			<div class="flex items-baseline gap-2.5 text-white">
				<span class="text-[13px] font-medium">{label}</span>
				<span class="tnum text-[12px] text-white/55">
					{(index as number) + 1} / {images.length}
				</span>
			</div>

			<div class="flex items-center gap-1.5">
				<a
					href={current.full}
					target="_blank"
					rel="noopener noreferrer"
					title="Открыть оригинал в новой вкладке"
					class="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/80
					       transition duration-[var(--t-fast)] hover:bg-white/10 hover:text-white"
				>
					<Icon name="external" size={15} />
				</a>
				<button
					type="button"
					onclick={onclose}
					title="Закрыть (Esc)"
					aria-label="Закрыть просмотр"
					class="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/80
					       transition duration-[var(--t-fast)] hover:bg-white/10 hover:text-white"
				>
					<Icon name="close" size={17} />
				</button>
			</div>
		</div>

		<!-- Полотно. min-h-0 обязателен: без него flex-элемент с картинкой не даёт
		     себя сжать и изображение вылезает за экран. -->
		<div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 md:px-16">
			{#if current.thumb && !loaded}
				<!--
					Превью в размытии, пока грузится полный файл: пустой чёрный
					прямоугольник читается как сбой загрузки. Держится не дольше
					загрузки — и с ошибкой загрузки тоже снимается, иначе размытие
					становится единственным, что видно.
				-->
				<img
					src={current.thumb}
					alt=""
					aria-hidden="true"
					class="pointer-events-none absolute inset-0 h-full w-full scale-105 object-contain
					       opacity-40 blur-xl"
				/>
			{/if}

			{#key current.full}
				<!--
					Прозрачностью управляем только до первой загрузки, а дальше картинка
					видна всегда. Полностью прятать её за состоянием нельзя: одна
					промашка с событием загрузки — и в просмотрщике вообще нет
					фотографии, только размытая заглушка.
				-->
				<img
					bind:this={imgEl}
					src={current.full}
					alt={current.caption ?? ''}
					onload={() => (loaded = true)}
					onerror={() => (loaded = true)}
					class="max-h-full max-w-full rounded-sm object-contain shadow-4 transition-opacity
					       duration-[var(--t-mid)]"
					style="opacity: {loaded ? 1 : 0.001}"
				/>
			{/key}

			{#if images.length > 1}
				<button
					type="button"
					onclick={() => step(-1)}
					aria-label="Предыдущее изображение"
					class="absolute left-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center
					       rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md
					       transition duration-[var(--t-fast)] hover:bg-black/80 md:left-4 md:h-14 md:w-14"
				>
					<Icon name="chevronLeft" size={24} />
				</button>
				<button
					type="button"
					onclick={() => step(1)}
					aria-label="Следующее изображение"
					class="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center
					       rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-md
					       transition duration-[var(--t-fast)] hover:bg-black/80 md:right-4 md:h-14 md:w-14"
				>
					<Icon name="chevronRight" size={24} />
				</button>
			{/if}
		</div>

		{#if current.caption}
			<p class="shrink-0 px-4 pb-4 text-center text-[12px] text-white/70 md:px-6">
				{current.caption}
			</p>
		{/if}

		<!-- Лента миниатюр: показывает, сколько ещё осталось, и даёт прыгнуть
		     сразу к нужному кадру вместо десяти нажатий стрелки. -->
		{#if images.length > 1}
			<div class="no-scrollbar shrink-0 overflow-x-auto px-4 pb-4 md:px-6">
				<div class="mx-auto flex w-max gap-2">
					{#each images as img, i (img.full)}
						<button
							type="button"
							onclick={() => onindex(i)}
							aria-label="{label} {i + 1}"
							aria-current={i === index ? 'true' : undefined}
							class="h-12 w-20 shrink-0 overflow-hidden rounded-sm border transition
							       duration-[var(--t-fast)] md:h-14 md:w-24 {i === index
								? 'border-accent opacity-100'
								: 'border-white/10 opacity-45 hover:opacity-80'}"
						>
							<img src={img.thumb ?? img.full} alt="" loading="lazy" class="h-full w-full object-cover" />
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
