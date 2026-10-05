<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { party, inParty, isHost, join, leave, savedName, withPartyParams, sharedPosition,
		serverNow, sendState, sendSeek, reportPlayback, sendTranslation, pushToast, type RoomSnapshot } from '$lib/party.svelte';
	import { watchHref } from '$lib/party-sync';
	import { RUTUBE_ORIGIN, rutubeEmbedUrl, rutubeVideoUrl, readRutubeMessage, rutubeNumber, rutubeQualities, rutubeCurrentQuality } from '$lib/rutube';
	import { enterFullscreen, exitFullscreen, fullscreenElement, fullscreenHint } from '$lib/player/fullscreen';
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
	let currentQuality = $state<number | null>(null);
	let qualityOpen = $state(false);
	let qualityButton: HTMLButtonElement | null = $state(null);
	let volume = $state(1);
	let muted = $state(false);
	let volumeOpen = $state(false);
	let fullscreenHelp = $state('');
	let helpShown = false;
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
		if (paused || setupOpen || qualityOpen || volumeOpen || error || ad || needsTap || !timelineReady) return;
		hideTimer = setTimeout(() => { controlsVisible = false; }, 3200);
	}
	function wakeFrom(event: Event) {
		if (!(event instanceof PointerEvent) || event.pointerType === 'mouse') wake();
	}
	$effect(() => {
		paused; setupOpen; qualityOpen; volumeOpen; error; ad; needsTap; timelineReady;
		untrack(wake);
		return () => { if (hideTimer) clearTimeout(hideTimer); };
	});

	function command(type: string, data: Record<string, unknown> = {}) {
		frame?.contentWindow?.postMessage(JSON.stringify({ type, data }), RUTUBE_ORIGIN);
	}
	function chooseQuality(value: string) {
		if (!apiReady || ad || !qualities.length || (value !== 'auto' && !qualities.includes(Number(value)))) return;
		quality = value;
		command('player:changeQuality', { quality: value });
		qualityOpen = false;
		qualityButton?.focus();
	}
	function changeVolume(value: number) {
		volume = Math.max(0, Math.min(1, value));
		muted = volume === 0;
		command('player:setVolume', { volume });
		command(muted ? 'player:mute' : 'player:unMute');
	}
	function toggleMute() {
		muted = !muted;
		if (!muted && volume === 0) changeVolume(0.5);
		else command(muted ? 'player:mute' : 'player:unMute');
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
		const initialize = !timelineReady || needsTap;
		needsTap = false;
		if (inParty()) {
			const wantsPause = !party.roomState?.paused;
			sendState(wantsPause, sharedPosition());
			// A first local Play can be required before the API reveals a timeline.
			// The server still holds the common clock until all viewers are ready.
			if (!wantsPause && initialize) play();
		}
		else if (paused) play(); else pause();
	}
	function userSeek(value: number) {
		if (inParty()) sendSeek(value); else seek(value);
	}
	function arm() {
		needsTap = false;
		play();
	}
	function showRoom() { qualityOpen = volumeOpen = false; if (inParty()) chatOpen = !chatOpen; else setupOpen = !setupOpen; }
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
		if (type === 'player:ready') { apiReady = true; error = ''; command('player:hideControls'); }
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
			// The live player emits "pause"; some API versions use "paused".
			if (data.state === 'playing' || data.state === 'pause' || data.state === 'paused' || data.state === 'stopped' || data.state === 'ended') {
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
		else if (type === 'player:qualityList') qualities = rutubeQualities(data.list);
		else if (type === 'player:currentQuality') {
			const info = rutubeCurrentQuality(data.quality);
			if (info) { currentQuality = info.height; if (info.selection !== null) quality = info.selection; }
		} else if (type === 'player:volumeChange') {
			const value = typeof data.volume === 'string' && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(data.volume) ? Number(data.volume) : data.volume;
			if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) volume = value;
			if (typeof data.muted === 'boolean') muted = data.muted;
		}
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
		else {
			pageFull = !(await enterFullscreen(root));
			if (pageFull && !helpShown) { fullscreenHelp = fullscreenHint() || ''; helpShown = !!fullscreenHelp; }
		}
		wake();
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
		const key = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (qualityOpen) { qualityOpen = false; qualityButton?.focus(); }
			else if (volumeOpen) volumeOpen = false;
			else if (fullscreenHelp) fullscreenHelp = '';
			else { pageFull = false; setupOpen = false; }
		};
		const outside = (event: PointerEvent) => {
			if (!(event.target instanceof Element)) return;
			if (qualityOpen && !event.target.closest('.rutube-settings, .rutube-quality-button')) qualityOpen = false;
			if (volumeOpen && !event.target.closest('.volume-panel, .volume-button')) volumeOpen = false;
		};
		const wake = () => { if (!document.hidden) { sync(); report(); } };
		window.addEventListener('keydown', key); window.addEventListener('pointerdown', outside); document.addEventListener('visibilitychange', wake);
		return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', outside); document.removeEventListener('visibilitychange', wake); };
	});
	function retry() {
		apiReady = timelineReady = false; error = ''; ad = false; needsTap = false;
		time = duration = 0; paused = expectedPause = true; qualities = []; quality = 'auto';
		currentQuality = null; qualityOpen = volumeOpen = false;
		lastPlayAt = lastCommandAt = lastSeekAt = lastTimeAt = 0; pendingSeek = null; reload++;
	}
</script>

<div bind:this={root} class="rutube-room" class:with-chat={chatOpen && inParty()} class:page-fullscreen={pageFull}
	style:height={nativeFull && !keyboardOpen ? '100dvh' : viewportHeight} style:top={pageFull || nativeFull ? nativeFull && !keyboardOpen ? '0px' : `${viewportTop}px` : undefined} class:keyboard-open={keyboardOpen}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="rutube-main" class:hud-hidden={!controlsVisible} onpointermove={wakeFrom} onfocusin={wakeFrom}>
		<header class="rutube-header" inert={!controlsVisible}>
			<a href="/rutube" aria-label="Назад" class="rutube-icon"><Icon name="chevronLeft" size={20} /></a>
			<div class="min-w-0 flex-1"><span class="text-[10px] font-semibold tracking-widest text-white/45">RUTUBE · СМОТРИМ ВМЕСТЕ</span><h1 class="truncate text-sm font-semibold sm:text-lg">{title}</h1></div>
			<button type="button" onclick={showRoom} class="rutube-icon" aria-label="Смотреть вместе"><Icon name="users" size={21} />{#if party.unread}<span class="text-xs">{party.unread}</span>{/if}</button>
		</header>
		<div class="rutube-frame">
			{#key reload}<iframe bind:this={frame} src={rutubeEmbedUrl(video.id)} title={title} allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>{/key}
			{#if ready}<button type="button" class="video-tap" onclick={wake} aria-label="Показать управление"></button>{/if}
			{#if countdown && !ad}<div class="countdown" aria-live="polite">{countdown}</div>{/if}
			<PartyReactions />
		</div>
		<div class="rutube-status" class:important-status={!!error || ad || needsTap || !timelineReady} aria-live="polite">
			{#if error}<p class="text-warn">{error} <button type="button" onclick={retry} class="underline">Повторить</button> · <a href={rutubeVideoUrl(video.id)} target="_blank" rel="noopener noreferrer" class="underline">Открыть на RUTUBE</a></p>
			{:else if ad}<p>Участник смотрит рекламу RUTUBE. Общий просмотр продолжится после готовности всех.</p>
			{:else if needsTap}<button type="button" onclick={arm} class="text-accent underline">Разрешить воспроизведение</button><span> — если видео не стартует, нажмите Play в плеере RUTUBE.</span>
			{:else if !timelineReady}<button type="button" onclick={arm} disabled={!apiReady} class="text-accent underline disabled:opacity-50">Загрузить видео</button><span> — RUTUBE может требовать первый Play у каждого зрителя.</span>
			{:else if party.roomState?.waitingForReady || party.roomState?.sourcePending}<p>Ждём готовности всех участников…</p>
			{:else}<p>{inParty() ? 'Кнопки ниже управляют общим просмотром.' : 'Создайте комнату через кнопку «Смотреть вместе».'}</p>{/if}
		</div>
		{#if qualityOpen}
			<section class="rutube-settings" id="rutube-settings" aria-label="Настройки плеера RUTUBE">
				<div class="settings-heading"><div><h2>Качество видео</h2><p>{currentQuality ? `Сейчас: ${currentQuality}p` : 'Настройка для вашего устройства'}</p></div><button type="button" class="rutube-icon" aria-label="Закрыть настройки качества" onclick={() => { qualityOpen = false; qualityButton?.focus(); }}><Icon name="close" size={18} /></button></div>
				{#if qualities.length}
					<div class="quality-options" role="group" aria-label="Доступное качество видео">
						{#each ['auto', ...qualities.map(String)] as level (level)}
							<button type="button" class="quality-option" class:selected={quality === level} aria-pressed={quality === level} disabled={ad} onclick={() => chooseQuality(level)}><span>{level === 'auto' ? 'Авто' : `${level}p`}{#if level === 'auto'}<small>По скорости сети</small>{:else if Number(level) >= 2160}<small>4K</small>{:else if Number(level) >= 1080}<small>Full HD</small>{:else if Number(level) >= 720}<small>HD</small>{/if}</span>{#if quality === level}<Icon name="check" size={16} />{/if}</button>
						{/each}
					</div>
				{:else}<p class="quality-pending">Уровни качества появятся после запуска видео. Доступные варианты определяет RUTUBE.</p>{/if}
				{#if inParty()}<p class="settings-note">Качество меняется только у вас — синхронизация комнаты сохраняется.</p>{/if}
			</section>
		{/if}
		{#if volumeOpen}
			<section class="volume-panel" aria-label="Громкость видео"><div><button type="button" onclick={toggleMute} disabled={!apiReady} aria-label={muted ? 'Включить звук' : 'Выключить звук'} class="sound-toggle"><Icon name={muted ? 'volumeOff' : 'volume'} size={18} /><span>{muted ? 'Без звука' : 'Громкость'}</span></button><span>{muted ? 0 : Math.round(volume * 100)}%</span></div><input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} oninput={(event) => changeVolume(Number(event.currentTarget.value))} disabled={!apiReady} aria-label="Громкость RUTUBE" /><p class="volume-note">На iPhone уровень звука регулируется также боковыми кнопками телефона.</p></section>
		{/if}
		<div class="rutube-controls" inert={!controlsVisible}>
			<div class="rutube-clock"><span>{formatTime(time)}</span><span>{formatTime(duration || video.duration)}</span></div>
			<input type="range" min="0" max={duration || video.duration || 1} step="1" value={time} disabled={!timelineReady || ad} onchange={(event) => userSeek(Number(event.currentTarget.value))} aria-label="Перемотка общего видео" class="w-full accent-accent" />
			<div class="flex min-w-0 items-center gap-1 sm:gap-2">
				<button type="button" onclick={toggle} disabled={!apiReady || !!error || ad} class="rutube-icon" aria-label={inParty() ? party.roomState?.paused ? 'Воспроизвести' : 'Пауза' : paused ? 'Воспроизвести' : 'Пауза'}><Icon name={(inParty() ? party.roomState?.paused : paused) ? 'play' : 'pause'} size={20} /></button>
				<button type="button" onclick={() => userSeek(Math.max(0, time - 10))} disabled={!timelineReady || ad} class="rutube-icon rutube-skip" aria-label="Назад на 10 секунд"><Icon name="rewind" size={18} /></button>
				<button type="button" onclick={() => userSeek(time + 10)} disabled={!timelineReady || ad} class="rutube-icon rutube-skip" aria-label="Вперёд на 10 секунд"><Icon name="forward" size={18} /></button>
				<button type="button" class="rutube-icon volume-button" aria-label="Громкость" aria-expanded={volumeOpen} onclick={() => { volumeOpen = !volumeOpen; qualityOpen = setupOpen = false; }}><Icon name={muted ? 'volumeOff' : 'volume'} size={20} /></button>
				<span class="min-w-0 flex-1"></span>
				<button bind:this={qualityButton} type="button" class="rutube-quality-button" aria-label="Качество RUTUBE" aria-expanded={qualityOpen} aria-controls="rutube-settings" onclick={() => { setupOpen = volumeOpen = false; qualityOpen = !qualityOpen; }}><Icon name="sliders" size={18} /><span>{quality === 'auto' ? 'Авто' : `${quality}p`}</span></button>
				<button type="button" onclick={showRoom} class="rutube-icon" aria-label="Открыть чат"><Icon name="chat" size={19} /></button>
				<button type="button" onclick={() => void toggleFull()} class="rutube-icon" aria-label={full ? 'Выйти из полного экрана' : 'Полный экран'}><Icon name={full ? 'fullscreenExit' : 'fullscreen'} size={18} /></button>
			</div>
			{#if setupOpen && !inParty()}<div class="relative"><PartySetup {snapshot} onClose={() => { setupOpen = false; chatOpen = inParty(); }} /></div>{/if}
		</div>
	</div>
	{#if chatOpen && inParty()}<PartyPanel compact={full} onClose={() => { chatOpen = false; }} />{/if}
	{#if fullscreenHelp}<div class="fullscreen-help" role="dialog" aria-label="Просмотр без адресной строки"><p>{fullscreenHelp}</p><button type="button" onclick={() => (fullscreenHelp = '')}>Понятно</button></div>{/if}
	{#if party.toasts.length}<div class="pointer-events-none absolute left-4 top-16 z-40 max-w-[90%] space-y-2">{#each party.toasts as toast (toast.id)}<p role="status" class="rounded-xl bg-black/90 px-4 py-3 text-sm">{toast.text}</p>{/each}</div>{/if}
</div>

<style>
	.rutube-room { position: relative; display: flex; width: 100%; overflow: hidden; background: #08090b; color: white; }
	.rutube-room.page-fullscreen { position: fixed; inset-inline: 0; z-index: 200; }
	.rutube-main { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
	.rutube-header { position: absolute; top: 0; inset-inline: 0; z-index: 25; display: flex; min-height: 62px; align-items: center; gap: 8px; padding: 4px 12px; background: linear-gradient(#08090bf0, #08090b90); transition: opacity .25s ease; }
	.rutube-frame { position: relative; flex: 1; min-height: 0; background: black; }
	.rutube-frame iframe { width: 100%; height: 100%; border: 0; }
	.video-tap { position: absolute; inset: 0; z-index: 12; cursor: pointer; background: transparent; touch-action: manipulation; }
	.video-tap:focus-visible { outline: 2px solid #dce2eb; outline-offset: -4px; }
	.fullscreen-help { position: absolute; z-index: 60; top: 70px; left: 12px; right: 12px; max-width: 380px; padding: 16px; border: 1px solid #ffffff25; border-radius: 16px; background: #111318f5; font-size: 13px; line-height: 1.5; box-shadow: 0 8px 30px #0008; }
	.fullscreen-help button { margin-top: 10px; min-height: 44px; padding-inline: 20px; border-radius: 12px; background: #dce2eb; color: #111318; font-weight: 600; }
	.rutube-clock { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #a4acba; font-variant-numeric: tabular-nums; }
	.rutube-icon { display: inline-flex; flex-shrink: 0; width: 42px; height: 42px; align-items: center; justify-content: center; gap: 2px; border-radius: 12px; }
	.rutube-icon:hover { background: #ffffff10; }
	.rutube-icon:disabled { opacity: 0.35; }
	.rutube-icon:focus-visible, .rutube-quality-button:focus-visible, .quality-option:focus-visible, .sound-toggle:focus-visible { outline: 2px solid #dce2eb; outline-offset: 2px; }
	.rutube-quality-button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; gap: 6px; min-height: 44px; padding: 0 12px; border: 1px solid #ffffff16; border-radius: 12px; background: #ffffff08; color: #edf0f5; font-size: 12px; font-weight: 600; }
	.rutube-quality-button:hover, .rutube-quality-button[aria-expanded="true"] { background: #ffffff12; border-color: #ffffff30; }
	.rutube-settings { position: absolute; bottom: max(98px, calc(90px + env(safe-area-inset-bottom))); right: 12px; z-index: 40; width: min(300px, calc(100% - 24px)); max-height: min(440px, calc(100% - 108px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; border: 1px solid #ffffff20; border-radius: 18px; padding: 14px; background: #111318f5; color: #edf0f5; box-shadow: 0 12px 40px #0008; backdrop-filter: blur(20px); }
	.settings-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
	.settings-heading h2 { font-size: 14px; font-weight: 600; }
	.settings-heading p { margin-top: 3px; font-size: 11px; color: #a4acba; }
	.settings-heading .rutube-icon { width: 36px; height: 36px; }
	.quality-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
	.quality-option { display: flex; min-height: 48px; align-items: center; justify-content: space-between; gap: 4px; padding: 8px 11px; border: 1px solid #ffffff14; border-radius: 10px; background: #ffffff05; color: #edf0f5; text-align: left; font-size: 13px; font-weight: 600; }
	.quality-option small { display: block; font-size: 10px; font-weight: 400; color: #a4acba; }
	.quality-option:hover { background: #ffffff0e; }
	.quality-option.selected { background: #dce2eb; border-color: #dce2eb; color: #111318; }
	.quality-option.selected small { color: #505868; }
	.quality-option:disabled { opacity: .5; }
	.quality-pending, .settings-note { font-size: 11px; line-height: 1.5; color: #a4acba; }
	.volume-panel { position: absolute; bottom: max(98px, calc(90px + env(safe-area-inset-bottom))); left: 12px; width: min(240px, calc(100% - 24px)); z-index: 40; padding: 10px 14px; border: 1px solid #ffffff20; border-radius: 16px; background: #111318f5; box-shadow: 0 8px 30px #0008; }
	.volume-panel > div { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #a4acba; }
	.sound-toggle { display: flex; min-height: 36px; align-items: center; gap: 7px; color: #edf0f5; }
	.volume-panel input { width: 100%; height: 32px; accent-color: #dce2eb; }
	.volume-note { color: #a4acba; font-size: 10px; line-height: 1.4; }
	.settings-note { margin-top: 8px; }
	.rutube-status { position: absolute; bottom: 92px; inset-inline: 0; z-index: 25; padding: 6px 16px; font-size: 11px; line-height: 1.5; color: #ffffffa0; background: #08090bd9; transition: opacity .25s ease; }
	.rutube-controls { position: absolute; bottom: 0; inset-inline: 0; z-index: 25; padding: 5px 12px max(8px, env(safe-area-inset-bottom)); background: linear-gradient(#08090b90, #08090bf5); transition: opacity .25s ease; }
	.hud-hidden .rutube-header, .hud-hidden .rutube-controls, .hud-hidden .rutube-status:not(.important-status) { opacity: 0; pointer-events: none; }
	.countdown { position: absolute; top: 15px; left: 50%; transform: translateX(-50%); pointer-events: none; border-radius: 18px; padding: 12px 24px; background: #000c; font-size: 48px; font-weight: bold; }
	@media (max-width: 639px) and (orientation: portrait) {
		.rutube-room.with-chat { flex-direction: column; }
		.with-chat .rutube-main { flex: 1 1 0; }
		.with-chat .rutube-header { min-height: 44px; }
		.with-chat .rutube-status:not(.important-status) { display: none; }
		.rutube-controls { padding-inline: 6px; }
		.rutube-icon { width: 40px; height: 44px; }
		.rutube-quality-button { padding-inline: 9px; }
	}
	@media (max-height: 500px) {
		.rutube-header { min-height: 40px; }
		.rutube-status:not(.important-status) { display: none; }
		.rutube-controls { padding-top: 0; }
	}
	@media (max-width: 359px) {
		.rutube-clock { font-size: 10px; }
	}
	@media (max-width: 359px) { .rutube-skip { display: none; } }
	.keyboard-open .rutube-header { display: none; }
	@media (max-width: 639px) and (orientation: portrait) { .keyboard-open.with-chat .rutube-main { flex: 0 0 110px; } }
	@media (prefers-reduced-motion: reduce) { .rutube-header, .rutube-controls, .rutube-status { transition: none; } }
</style>
