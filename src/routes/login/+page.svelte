<script lang="ts">
	/**
	 * Вход.
	 *
	 * Переделано только оформление. Логика формы (progressive enhancement,
	 * восстановление имени после ошибки, состояние отправки) осталась прежней:
	 * она завязана на серверный action, и трогать её ради вида нельзя.
	 *
	 * Экран сознательно скромный. Это не витрина, а шлагбаум: чем меньше на нём
	 * всего, тем быстрее человек проходит. Единственная роскошь — свечение за
	 * карточкой, чтобы форма не висела в пустоте.
	 */

	import { enhance } from '$app/forms';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const field =
		'h-11 w-full rounded-sm border border-line bg-surface px-3.5 text-sm text-ink outline-none ' +
		'transition placeholder:text-faint focus:border-line-strong focus:bg-surface-2';
</script>

<svelte:head><title>Вход — КИНЕМА</title></svelte:head>

<main class="relative grid min-h-[calc(100dvh-4rem)] place-items-center px-[var(--gutter)] py-12">
	<div class="aurora" aria-hidden="true"></div>

	<div class="relative w-full max-w-sm">
		<a
			href="/"
			class="mb-8 flex justify-center transition hover:opacity-80"
			aria-label="КИНЕМА — на главную"
		>
			<Logo size={30} />
		</a>

		<div class="rounded-lg border border-line-soft bg-surface/50 p-6 shadow-3 md:p-8">
			<h1 class="display-lg mb-2 text-2xl text-ink">Вход</h1>
			<p class="mb-6 text-[13px] leading-relaxed text-dim">
				Учётная запись вашего сервера Jellyfin. Отдельной регистрации в КИНЕМА нет — логин и
				пароль те же, что и в медиатеке.
			</p>

			{#if data.demoMode}
				<div
					class="mb-5 flex items-start gap-2.5 rounded-sm border border-line bg-canvas/50 p-3.5
					       text-[12px] leading-relaxed text-dim"
					role="status"
				>
					<span class="mt-px shrink-0 text-faint"><Icon name="info" size={14} /></span>
					<p>
						Сейчас включён демо-режим — вход не требуется и ни к чему не приведёт. Укажите
						<code class="text-accent">JELLYFIN_URL</code> и
						<code class="text-accent">TMDB_API_KEY</code> в <code>.env</code>.
					</p>
				</div>
			{/if}

			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				class="space-y-4"
			>
				<div>
					<label for="username" class="mb-1.5 block text-xs font-medium text-dim">
						Имя пользователя
					</label>
					<input
						id="username"
						name="username"
						type="text"
						autocomplete="username"
						required
						value={form?.username ?? ''}
						class={field}
					/>
				</div>

				<div>
					<label for="password" class="mb-1.5 block text-xs font-medium text-dim">Пароль</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						class={field}
					/>
				</div>

				{#if form?.message}
					<p
						class="flex items-start gap-2 rounded-sm border border-bad/35 bg-bad/10 px-3 py-2.5
						       text-[12px] leading-relaxed text-bad"
						role="alert"
					>
						<span class="mt-px shrink-0"><Icon name="info" size={14} /></span>
						{form.message}
					</p>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent
					       text-sm font-semibold text-accent-ink transition hover:bg-accent-hover
					       disabled:opacity-55"
					style="box-shadow: var(--glow-sm)"
				>
					{#if submitting}
						<span
							class="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-accent-ink/35
							       border-t-accent-ink"
							aria-hidden="true"
						></span>
						Проверяем…
					{:else}
						<Icon name="login" size={16} />
						Войти
					{/if}
				</button>
			</form>
		</div>

		<p class="mt-5 text-center text-[11.5px] leading-relaxed text-faint">
			Каталог, подбор и списки «Смотреть позже» работают без входа. Учётная запись нужна только
			для воспроизведения из вашей медиатеки.
		</p>
	</div>
</main>
