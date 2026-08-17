<script lang="ts">
	/**
	 * Общая страница ошибки: 404, 500 и всё остальное.
	 *
	 * Код статуса подан графикой — контурная цифра во весь экран, тем же приёмом,
	 * что и номера в нумерованных рядах. Причина простая: 404 люди видят чаще,
	 * чем нам хотелось бы, и техническая простыня в этот момент бесполезна. Нужен
	 * ответ на два вопроса — что случилось и куда идти дальше.
	 *
	 * Сообщение сервера показываем только если оно что-то добавляет. Служебные
	 * «Not Found» и «Internal Error» SvelteKit подставляет сам, и рядом с русским
	 * объяснением они выглядят как второй, недоделанный текст.
	 */

	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';

	const status = $derived(page.status);

	const heading = $derived(
		status === 404 ? 'Такой страницы нет' : 'Что-то сломалось на нашей стороне'
	);

	const explain = $derived.by(() => {
		if (status === 404) {
			return 'Ссылка устарела, в адресе опечатка или тайтл убрали из каталога. Ничего не потеряно — начните с главной или сразу с подбора.';
		}
		if (status === 401 || status === 403) {
			return 'Раздел закрыт для текущей сессии. Возможно, нужно войти под своей учётной записью Jellyfin.';
		}
		return 'Запрос не удалось обработать. Обычно это временно: каталог зависит от внешних сервисов, и через минуту-другую он отвечает снова.';
	});

	const GENERIC = ['Not Found', 'Internal Error', 'Internal Server Error'];

	const detail = $derived.by(() => {
		const message = page.error?.message?.trim();
		if (!message || GENERIC.includes(message) || message === heading) return null;
		return message;
	});
</script>

<svelte:head>
	<title>{status} · {heading} — КИНЕМА</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main
	class="relative grid min-h-[calc(100dvh-8rem)] place-items-center overflow-hidden
	       px-[var(--gutter)] py-16"
>
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-xl text-center">
		<p
			class="display-xl pointer-events-none select-none text-[7rem] text-transparent md:text-[11rem]"
			style="-webkit-text-stroke: 2px rgb(var(--c-glow) / 0.5)"
			aria-hidden="true"
		>
			{status}
		</p>

		<h1 class="display-lg mt-1 text-2xl text-ink md:mt-2 md:text-4xl">
			<span class="sr-only">Ошибка {status}. </span>{heading}
		</h1>

		<p class="mx-auto mt-4 max-w-md text-[13.5px] leading-relaxed text-dim">{explain}</p>

		{#if detail}
			<p class="mx-auto mt-3 max-w-md text-[11.5px] leading-relaxed text-faint">{detail}</p>
		{/if}

		<div class="mt-8 flex flex-wrap justify-center gap-2.5">
			<a
				href="/"
				class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
				       font-semibold text-accent-ink transition hover:bg-accent-hover"
				style="box-shadow: var(--glow-sm)"
			>
				<Icon name="home" size={16} />
				На главную
			</a>
			<a
				href="/picker"
				class="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface/60
				       px-6 text-sm text-ink transition hover:border-line-strong hover:bg-surface-2"
			>
				<Icon name="dice" size={16} />
				Подобрать фильм
			</a>
		</div>
	</div>
</main>
