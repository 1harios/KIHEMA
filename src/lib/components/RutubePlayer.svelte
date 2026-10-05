<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { party, inParty, isHost, join, leave, savedName, withPartyParams, sharedPosition,
		serverNow, sendState, sendSeek, reportPlayback, sendTranslation, pushToast, type RoomSnapshot } from '$lib/party.svelte';
	import { watchHref } from '$lib/party-sync';
	import { RUTUBE_ORIGIN, rutubeEmbedUrl, rutubeVideoUrl, readRutubeMessage, rutubeNumber } from '$lib/rutube';
	import { enterFullscreen, exitFullscreen, fullscreenElement } from '$lib/player/fullscreen';
	import { formatTime } from '$lib/player/controller.svelte';
	import type { RutubeMetadata } from '$lib/server/rutube';
	import Icon from './ui/Icon.svelte';
	import PartyPanel from './party/PartyPanel.svelte';
	import PartySetup from './party/PartySetup.svelte';
	import PartyReactions from './party/PartyReactions.svelte';

	let { video }: { video: RutubeMetadata } = $props();
	let root: HTMLElement | null = $state(null);
	let frame: HTMLIFrameElement | null = $state(null);
	let setupOpen = $state(false);
	let chatOpen = $state(false);
	let nativeFull = $state(false);
	let pageFull = $state(false);
	let viewportHeight = $state('100dvh');
	let viewportTop = $state(0);
	let keyboardOpen = $state(false);
	let reload = $state(0);
	let apiReady = $state(false);
	let timelineReady = $state(false);
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let ad = $state(false);
	let needsTap = $state(false);
	let error = $state('');
	let title = $state(untrack(() => video.title));
	let qualities = $state<number[]>([]);
	let quality = $state('auto');
	let countdown = $state(0);
	let controlsVisible = $state(true);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let lastCommandAt = 0;
	let lastPlayAt = 0;
	let lastSeekAt = 0;
	let lastTimeAt = 0;
	let expectedPause = true;
	let pendingSeek: number | null = null;
	let joinAttempt: string | null = null;
	const ready = $derived(apiReady && timelineReady && !ad && !error && !needsTap);
	const full = $derived(pageFull || nativeFull);
	const href = $derived(watchHref(page.url.pathname) ?? '');

	function wake() {
		controlsVisible = true;
		if (hideTimer) clearTimeout(hideTimer);
		if (paused || setupOpen || error || ad || needsTap || !timelineReady) return;
		hideTimer = setTimeout(() => { controlsVisible = false; }, 3200);
	}
	function wakeFrom(event: Event) {
		if (!(event.target instanceof Element && event.target.closest('.show-controls'))) wake();
	}
	$effect(() => {
		paused; setupOpen; error; ad; needsTap; timelineReady;
		untrack(wake);
		return () => { if (hideTimer) clearTimeout(hideTimer); };
	});

	function command(type: string, data: Record<string, unknown> = {}) {
		frame?.contentWindow?.postMessage(JSON.stringify({ type, data }), RUTUBE_ORIGIN);
	}
	function play() { expectedPause = false; lastPlayAt = lastCommandAt = Date.now(); command('player:play'); }
	function pause() { expectedPause = true; lastCommandAt = Date.now(); command('player:pause'); }
	function seek(value: number) {
		if (!timelineReady || ad) return;
		pendingSeek = Math.max(0, Math.min(value, duration || Infinity));
		lastSeekAt = lastCommandAt = Date.now();
		command('player:setCurrentTime', { time: pendingSeek });
	}
	function snapshot(): RoomSnapshot { return { targetHref: href, paused, positionSec: time, translationLabel: null, torrent: null }; }
	function toggle() {
		needsTap = false;
		if (inParty()) sendState(!party.roomState?.paused, sharedPosition());
		else if (paused) play(); else pause();
	}
	function userSeek(value: number) {
		if (inParty()) sendSeek(value); else seek(value);
	}
	function arm() {
		needsTap = false;
		play();
	}
	function showRoom() { if (inParty()) chatOpen = !chatOpen; else setupOpen = !setupOpen; }
	function mediaTime() {
		return time + (!paused && !ad && lastTimeAt ? Math.min(1000, Date.now() - lastTimeAt) / 1000 : 0);
	}
	function report() {
		if (party.status !== 'in-room') return;
		const positioned = !party.roomState?.waitingForReady || Math.abs(mediaTime() - sharedPosition()) < 1.5;
		const stalled = !paused && !ad && lastTimeAt > 0 && Date.now() - lastTimeAt > 6000;
		reportPlayback({ targetHref: href, ready: ready && positioned && !stalled, buffering: !ready || stalled,
			blocking: ad || needsTap, positionSec: mediaTime(), translationLabel: null, torrent: null });
	}
	function sync() {
		const st = party.roomState;
		if (party.status !== 'in-room' || !st || st.targetHref !== href || !apiReady || ad || error) return;
		const hold = st.paused || st.waitingForReady || st.sourcePending || st.buffering || serverNow() < st.anchorTs;
		if (hold && !paused && Date.now() - lastCommandAt > 400) pause();
		const position = Math.min(sharedPosition(), duration || Infinity);
		if (timelineReady && !needsTap && Date.now() - lastSeekAt > 3000 && Math.abs(position - mediaTime()) > (hold ? 0.4 : 1.5)) seek(position);
		if (!hold && paused && !needsTap) {
			if (lastPlayAt && Date.now() - lastPlayAt > 2500 && !expectedPause) {
				needsTap = true; report();
			} else if (expectedPause && Date.now() - lastCommandAt > 500) play();
		}
	}
	function onMessage(event: MessageEvent) {
		const message = readRutubeMessage(event, frame?.contentWindow ?? null);
		if (!message) return;
		const { type, data } = message;
		if (type === 'player:ready') { apiReady = true; error = ''; }
		else if (type === 'player:durationChange') {
			const value = rutubeNumber(data.duration);
			if (value && value > 0) { duration = value; timelineReady = true; error = ''; }
		} else if (type === 'player:playOptionsLoaded' || type === 'player:playOptionLoaded') {
			if (typeof data.title === 'string') title = data.title.slice(0, 250);
		} else if (type === 'player:currentTime') {
			const value = rutubeNumber(data.time);
			if (value !== null && !ad) {
				const previous = time;
				if (Math.abs(value - time) > 0.01) lastTimeAt = Date.now();
				time = value;
				if (pendingSeek !== null && Math.abs(value - pendingSeek) < 1.5) pendingSeek = null;
				// Native iframe controls have no user-intent event. Only the host's
				// large, non-command timeline jumps are forwarded to the room.
				if (inParty() && isHost() && pendingSeek === null && Date.now() - lastCommandAt > 2000 && Math.abs(value - previous) > 3) sendSeek(value);
			}
		} else if (type === 'player:changeState') {
			if (data.state === 'playing' || data.state === 'paused' || data.state === 'stopped') {
				const wasPaused = paused;
				paused = data.state !== 'playing';
				if (!paused) { needsTap = false; lastTimeAt = Date.now(); }
				// A native pause is a new intent, not a failed old play command.
				// Otherwise the next shared start falsely requests autoplay permission.
				if (paused && Date.now() - lastCommandAt > 1800) { expectedPause = true; lastPlayAt = 0; }
				if (inParty() && isHost() && !ad && wasPaused !== paused && Date.now() - lastCommandAt > 1800 && !party.roomState?.waitingForReady && !party.roomState?.sourcePending) sendState(paused, time);
			}
		} else if (type === 'player:adStart' || (type === 'player:rollState' && data.state === 'play')) ad = true;
		else if (type === 'player:adEnd' || (type === 'player:rollState' && data.state === 'complete')) { ad = false; lastTimeAt = Date.now(); }
		else if (type === 'player:qualityList' && Array.isArray(data.list)) qualities = [...new Set(data.list.filter((q): q is number => typeof q === 'number' && q > 0 && q <= 4320))].sort((a, b) => a - b);
		else if (type === 'player:error') error = 'RUTUBE не может воспроизвести этот ролик. Проверьте его доступность на RUTUBE.';
		else if (type === 'player:playComplete') paused = true;
		if (isHost() && ready && party.roomState?.sourcePending && party.roomState.targetHref === href) sendTranslation(null, null);
		report();
	}
	$effect(() => {
		if (!frame) return;
		const listener = (event: MessageEvent) => untrack(() => onMessage(event));
		window.addEventListener('message', listener);
		const timeout = setTimeout(() => { if (!timelineReady && !ad) error = 'Плеер не получил видео от RUTUBE. Возможно, ролик недоступен для встраивания или в этой сети.'; }, 25_000);
		return () => { window.removeEventListener('message', listener); clearTimeout(timeout); };
	});
	$effect(() => {
		const code = page.url.searchParams.get('room');
		if (!code || code === joinAttempt || inParty() || party.status === 'connecting') return;
		joinAttempt = code;
		void join(code, savedName() || 'Гость', null).catch((e) => { pushToast(e.message); setupOpen = true; });
	});
	$effect(() => {
		const st = party.roomState;
		if (inParty() && st?.targetHref && st.targetHref !== href) void goto(withPartyParams(st.targetHref));
	});
	$effect(() => {
		party.roomState; party.status; ready;
		untrack(() => { sync(); report(); });
	});
	$effect(() => {
		if (!inParty()) return;
		const interval = setInterval(() => { sync(); report(); }, 750);
		return () => clearInterval(interval);
	});
	$effect(() => {
		const until = party.countdownUntil;
		if (!until) { countdown = 0; return; }
		const update = () => { countdown = Math.max(0, Math.ceil((until - Date.now()) / 1000)); };
		update(); const interval = setInterval(update, 100);
		return () => clearInterval(interval);
	});
	beforeNavigate(({ to }) => { if (inParty() && !to?.url.pathname.endsWith('/watch')) leave(); });
	async function toggleFull() {
		if (!root) return;
		if (pageFull) pageFull = false;
		else if (fullscreenElement()) await exitFullscreen().catch(() => {});
		else pageFull = !(await enterFullscreen(root));
	}
	$effect(() => {
		const update = () => { nativeFull = fullscreenElement() === root; };
		document.addEventListener('fullscreenchange', update);
		document.addEventListener('webkitfullscreenchange', update);
		return () => { document.removeEventListener('fullscreenchange', update); document.removeEventListener('webkitfullscreenchange', update); };
	});
	$effect(() => {
		const vp = window.visualViewport;
		const update = () => { viewportHeight = `${vp?.height ?? innerHeight}px`; viewportTop = vp?.offsetTop ?? 0; keyboardOpen = (vp?.height ?? innerHeight) < innerHeight * 0.75; };
		update(); vp?.addEventListener('resize', update); vp?.addEventListener('scroll', update); window.addEventListener('resize', update);
		return () => { vp?.removeEventListener('resize', update); vp?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
	});
	$effect(() => {
		if (!pageFull) return;
		const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});
	$effect(() => {
		const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { pageFull = false; setupOpen = false; } };
		const wake = () => { if (!document.hidden) { sync(); report(); } };
		window.addEventListener('keydown', key); document.addEventListener('visibilitychange', wake);
		return () => { window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', wake); };
	});
	function retry() {
		apiReady = timelineReady = false; error = ''; ad = false; needsTap = false;
		time = duration = 0; paused = expectedPause = true; qualities = []; quality = 'auto';
		lastPlayAt = lastCommandAt = lastSeekAt = lastTimeAt = 0; pendingSeek = null; reload++;
	}
</script>

<div bind:this={root} class="rutube-room" class:with-chat={chatOpen && inParty()} class:page-fullscreen={pageFull}
	style:height={viewportHeight} style:top={pageFull || nativeFull ? `${viewportTop}px` : undefined} class:keyboard-open={keyboardOpen}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="rutube-main" class:hud-hidden={!controlsVisible} onpointermove={wakeFrom} onfocusin={wakeFrom}>
		<header class="rutube-header" inert={!controlsVisible}>
			<a href="/rutube" aria-label="Назад" class="rutube-icon"><Icon name="chevronLeft" size={20} /></a>
			<div class="min-w-0 flex-1"><span class="text-[10px] font-semibold tracking-widest text-white/45">RUTUBE · СМОТРИМ ВМЕСТЕ</span><h1 class="truncate text-sm font-semibold sm:text-lg">{title}</h1></div>
			<button type="button" onclick={showRoom} class="rutube-icon" aria-label="Смотреть вместе"><Icon name="users" size={21} />{#if party.unread}<span class="text-xs">{party.unread}</span>{/if}</button>
		</header>
		<div class="rutube-frame">
			{#key reload}<iframe bind:this={frame} src={rutubeEmbedUrl(video.id)} title={title} allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>{/key}
			{#if countdown && !ad}<div class="countdown" aria-live="polite">{countdown}</div>{/if}
			<PartyReactions />
		</div>
		<button type="button" onclick={wake} class="show-controls" inert={controlsVisible} aria-hidden={controlsVisible} aria-label="Показать управление"><Icon name="chevronDown" size={18} /></button>
		<div class="rutube-status" class:important-status={!!error || ad || needsTap} aria-live="polite">
			{#if error}<p class="text-warn">{error} <button type="button" onclick={retry} class="underline">Повторить</button> · <a href={rutubeVideoUrl(video.id)} target="_blank" rel="noopener noreferrer" class="underline">Открыть на RUTUBE</a></p>
			{:else if ad}<p>Участник смотрит рекламу RUTUBE. Общий просмотр продолжится после готовности всех.</p>
			{:else if needsTap}<button type="button" onclick={arm} class="text-accent underline">Разрешить воспроизведение</button><span> — если видео не стартует, нажмите Play в плеере RUTUBE.</span>
			{:else if party.roomState?.waitingForReady || party.roomState?.sourcePending}<p>Ждём готовности всех участников…</p>
			{:else if !timelineReady}<p>Нажмите Play в плеере RUTUBE, если он ожидает разрешение браузера.</p>
			{:else}<p>{inParty() ? 'Кнопки ниже управляют общим просмотром.' : 'Создайте комнату через кнопку «Смотреть вместе».'}</p>{/if}
		</div>
		<div class="rutube-controls" inert={!controlsVisible}>
			<input type="range" min="0" max={duration || video.duration || 1} step="1" value={time} disabled={!timelineReady || ad} onchange={(event) => userSeek(Number(event.currentTarget.value))} aria-label="Перемотка общего видео" class="w-full accent-accent" />
			<div class="flex min-w-0 items-center gap-1 sm:gap-2">
				<button type="button" onclick={toggle} disabled={!apiReady || !!error || ad} class="rutube-icon" aria-label={inParty() ? party.roomState?.paused ? 'Воспроизвести' : 'Пауза' : paused ? 'Воспроизвести' : 'Пауза'}><Icon name={(inParty() ? party.roomState?.paused : paused) ? 'play' : 'pause'} size={20} /></button>
				<button type="button" onclick={() => userSeek(Math.max(0, time - 10))} disabled={!timelineReady || ad} class="rutube-icon" aria-label="Назад на 10 секунд"><Icon name="rewind" size={18} /></button>
				<button type="button" onclick={() => userSeek(time + 10)} disabled={!timelineReady || ad} class="rutube-icon" aria-label="Вперёд на 10 секунд"><Icon name="forward" size={18} /></button>
				<span class="rutube-clock min-w-0 flex-1 truncate text-[11px] text-white/60">{formatTime(time)} / {formatTime(duration || video.duration)}</span>
				{#if qualities.length}<select bind:value={quality} onchange={() => command('player:changeQuality', { quality })} aria-label="Качество RUTUBE" class="max-w-20 rounded-lg bg-white/10 px-1 py-2 text-xs"><option value="auto">Авто</option>{#each qualities as level}<option value={String(level)}>{level}p</option>{/each}</select>{/if}
				<button type="button" onclick={showRoom} class="rutube-icon" aria-label="Открыть чат"><Icon name="chat" size={19} /></button>
				<button type="button" onclick={() => void toggleFull()} class="rutube-icon" aria-label={full ? 'Выйти из полного экрана' : 'Полный экран'}><Icon name={full ? 'fullscreenExit' : 'fullscreen'} size={18} /></button>
			</div>
			{#if setupOpen && !inParty()}<div class="relative"><PartySetup {snapshot} onClose={() => { setupOpen = false; chatOpen = inParty(); }} /></div>{/if}
		</div>
	</div>
	{#if chatOpen && inParty()}<PartyPanel compact={full} onClose={() => { chatOpen = false; }} />{/if}
	{#if party.toasts.length}<div class="pointer-events-none absolute left-4 top-16 z-40 max-w-[90%] space-y-2">{#each party.toasts as toast (toast.id)}<p role="status" class="rounded-xl bg-black/90 px-4 py-3 text-sm">{toast.text}</p>{/each}</div>{/if}
</div>

<style>
	.rutube-room { position: relative; display: flex; width: 100%; overflow: hidden; background: #08090b; color: white; }
	.rutube-room.page-fullscreen { position: fixed; inset-inline: 0; z-index: 200; }
	.rutube-main { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
	.rutube-header { position: absolute; top: 0; inset-inline: 0; z-index: 25; display: flex; min-height: 62px; align-items: center; gap: 8px; padding: 4px 12px; background: linear-gradient(#08090bf0, #08090b90); transition: opacity .25s ease; }
	.rutube-frame { position: relative; flex: 1; min-height: 0; background: black; }
	.rutube-frame iframe { width: 100%; height: 100%; border: 0; }
	.rutube-icon { display: inline-flex; flex-shrink: 0; width: 42px; height: 42px; align-items: center; justify-content: center; gap: 2px; border-radius: 12px; }
	.rutube-icon:hover { background: #ffffff10; }
	.rutube-icon:disabled { opacity: 0.35; }
	.rutube-status { position: absolute; bottom: 78px; inset-inline: 0; z-index: 25; padding: 6px 16px; font-size: 11px; line-height: 1.5; color: #ffffffa0; background: #08090bd9; transition: opacity .25s ease; }
	.rutube-controls { position: absolute; bottom: 0; inset-inline: 0; z-index: 25; padding: 5px 12px max(8px, env(safe-area-inset-bottom)); background: linear-gradient(#08090b90, #08090bf5); transition: opacity .25s ease; }
	.hud-hidden .rutube-header, .hud-hidden .rutube-controls, .hud-hidden .rutube-status:not(.important-status) { opacity: 0; pointer-events: none; }
	.show-controls { position: absolute; z-index: 26; top: max(8px, env(safe-area-inset-top)); right: 12px; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #08090b80; color: #ffffffa0; }
	.rutube-main:not(.hud-hidden) .show-controls { opacity: 0; pointer-events: none; }
	.countdown { position: absolute; top: 15px; left: 50%; transform: translateX(-50%); pointer-events: none; border-radius: 18px; padding: 12px 24px; background: #000c; font-size: 48px; font-weight: bold; }
	@media (max-width: 639px) and (orientation: portrait) {
		.rutube-room.with-chat { flex-direction: column; }
		.with-chat .rutube-main { flex: 0 0 43%; }
		.with-chat .rutube-header { min-height: 44px; }
		.with-chat .rutube-status:not(.important-status) { display: none; }
		.rutube-controls { padding-inline: 6px; }
		.rutube-icon { width: 36px; height: 40px; }
	}
	@media (max-height: 500px) {
		.rutube-header { min-height: 40px; }
		.rutube-status:not(.important-status) { display: none; }
		.rutube-controls { padding-top: 0; }
	}
	@media (max-width: 359px) {
		.rutube-clock { font-size: 10px; }
		.rutube-controls select { max-width: 58px; }
	}
	.keyboard-open .rutube-header { display: none; }
	@media (prefers-reduced-motion: reduce) { .rutube-header, .rutube-controls, .rutube-status { transition: none; } }
</style>
