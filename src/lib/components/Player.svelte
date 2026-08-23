<script lang="ts">
	/**
	 * Плеер.
	 *
	 * Переписан под оформление сайта. Что изменилось по сути, а не по виду:
	 *
	 * — ВЫБОР КАЧЕСТВА. Его раньше не было вообще: hls.js подключался, но API
	 *   уровней не использовался. Теперь уровни манифеста читаются и выбираются,
	 *   выбор запоминается по высоте (см. controller). Там, где уровней нет —
	 *   нативный HLS в Safari, DASH — пункт не показывается, а не врёт «Авто».
	 *
	 * — ОДНА ПАНЕЛЬ НАСТРОЕК вместо трёх отдельных поповеров. Озвучка, субтитры,
	 *   качество и скорость лежали бы в трёх разных местах, и чтобы сменить две
	 *   вещи, приходилось бы открывать меню дважды.
	 *
	 * — ЭКРАН ОЖИДАНИЯ вместо чёрного прямоугольника. Пока резолвится поток,
	 *   виден кадр тайтла: ожидание читается как загрузка, а не как поломка. Это
	 *   не ускоряет загрузку, но убирает ощущение, что плеер сломался.
	 *
	 * Логику воспроизведения не трогал. Смена озвучки по-прежнему пересобирает
	 * источник — это ограничение Jellyfin (один аудиотрек на манифест), а не
	 * недоработка клиента.
	 */

	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { keyHelp, registerKeys } from '$lib/keys.svelte';
	import {
		party,
		inParty,
		isHost,
		applyRemote,
		pushToast,
		savedName,
		sharedPosition,
		withPartyParams,
		join as partyJoin,
		leave as partyLeave,
		sendBuffering,
		sendGoto,
		sendState,
		sendSeek,
		sendTranslation
	} from '$lib/party.svelte';
	import type { RoomSnapshot } from '$lib/party.svelte';
	import {
		PLAYBACK_RATES,
		PlayerController,
		formatTime,
		type PlayerTarget
	} from '$lib/player/controller.svelte';
	import { progress } from '$lib/progress.svelte';
	import type { PlaybackContext } from '$lib/types';
	import Icon from './ui/Icon.svelte';
	import PartyPanel from './party/PartyPanel.svelte';
	import PartySetup from './party/PartySetup.svelte';

	interface Props {
		target: PlayerTarget;
		context: PlaybackContext;
		/** Кадр и постер тайтла — только для экрана ожидания. */
		art?: { backdrop?: string; poster?: string };
		backHref: string;
	}

	let { target, context, art, backHref }: Props = $props();

	const player = new PlayerController();

	let container: HTMLElement | null = $state(null);
	let videoEl: HTMLVideoElement | null = $state(null);
	let controlsVisible = $state(true);
	let settingsOpen = $state(false);
	let isFullscreen = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
	let loadingStep = $state(0);

	const LOADING_STEPS = ['Ищем источник', 'Проверяем поток', 'Готовим воспроизведение'];
	const loadingLabel = $derived(
		player.status === 'switching' ? 'Меняем озвучку' : LOADING_STEPS[loadingStep]
	);

	$effect(() => {
		if (player.status !== 'loading') {
			loadingStep = 0;
			return;
		}
		const id = setInterval(() => {
			loadingStep = (loadingStep + 1) % LOADING_STEPS.length;
		}, 1800);
		return () => clearInterval(id);
	});

	/**
	 * Всплывающая подсказка перемотки: «−10 сек» / «+10 сек».
	 *
	 * Нужна потому, что по иконке невозможно понять величину шага, а угадывать
	 * пользователь не должен. Копим сумму подряд идущих нажатий: три быстрых
	 * клика показывают «+30 сек», а не три раза «+10».
	 */
	let seekHint = $state<{ delta: number; id: number } | null>(null);
	let seekHintTimer: ReturnType<typeof setTimeout> | null = null;

	function skip(delta: number) {
		player.skipBy(delta);

		const accumulated = seekHint ? seekHint.delta + delta : delta;
		seekHint = { delta: accumulated, id: Date.now() };

		if (seekHintTimer) clearTimeout(seekHintTimer);
		seekHintTimer = setTimeout(() => (seekHint = null), 900);
		wake();
	}

	/** Русские секунды: 1 секунда, 2 секунды, 5 секунд. */
	function secondsWord(n: number): string {
		const d10 = n % 10;
		const d100 = n % 100;
		if (d10 === 1 && d100 !== 11) return 'секунда';
		if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'секунды';
		return 'секунд';
	}

	/* --------------------------- жизненный цикл ---------------------------- */

	/**
	 * Ключ тайтла — примитив. SvelteKit пересоздаёт объект data.target на каждой
	 * инвалидации страницы, и эффект, подписанный на поля/идентичность объекта,
	 * уходил в бесконечный цикл (load() дёргался ~125 раз/сек, плеер мигал
	 * «Меняем озвучку…»). Подписка только на строку разрывает цикл: ключ меняется
	 * лишь при реальной смене тайтла/серии.
	 */
	const targetKey = $derived(
		`${target.type}:${target.tmdbId}:${target.season ?? ''}:${target.episode ?? ''}`
	);

	$effect(() => {
		if (!videoEl) return;
		const key = targetKey;
		// Объект читаем без подписки — иначе его пересоздание снова уронит эффект.
		const t = untrack(() => target);
		const unbind = player.bindVideo(videoEl);
		// load() синхронно читает реактивные source/currentTime, а по завершении
		// пишет source (новый объект) — без untrack это зацикливает эффект:
		// load → source записан → эффект перезапущен → load → …
		untrack(() =>
			player.load(
				{ type: t.type, tmdbId: t.tmdbId, season: t.season, episode: t.episode },
				{ resumeSec: startFrom() }
			)
		);
		return () => {
			unbind();
			player.destroy();
		};
	});

	/**
	 * С какой секунды начинать.
	 *
	 * Параметр ?t= — явная просьба: по нему приходят из ряда «продолжить
	 * просмотр», и он же позволяет начать сначала (t=0). Если его нет, берём
	 * локальный прогресс: человек мог нажать «Смотреть» на карточке, и начинать
	 * с нуля недосмотренный фильм — худшее, что можно сделать.
	 */
	function startFrom(): number | undefined {
		const raw = page.url.searchParams.get('t');
		if (raw !== null) {
			const parsed = Number.parseInt(raw, 10);
			return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
		}
		const t = untrack(() => target);
		const hit = progress.items.find(
			(e) =>
				e.type === t.type &&
				e.tmdbId === t.tmdbId &&
				(t.type === 'movie' || (e.season === (t.season ?? 1) && e.episode === (t.episode ?? 1)))
		);
		return hit?.positionSec;
	}

	/* ------------------------------ прогресс ------------------------------- */

	/**
	 * Локальная запись позиции.
	 *
	 * Отдельно от отчётов контроллера в Jellyfin: те работают только при
	 * подключённой медиатеке, а «продолжить просмотр» на главной должно работать
	 * всегда. Раз в 5 секунд — компромисс между точностью возврата и записью в
	 * localStorage; при уходе со страницы пишем принудительно, иначе теряются
	 * последние секунды.
	 */
	function persist() {
		// untrack обязателен: этот же вызов стоит в эффекте паузы, и без него
		// currentTime стал бы его зависимостью — эффект перезапускался бы на
		// каждом кадре перемотки и писал в localStorage десятки раз подряд.
		untrack(() => persistNow());
	}

	function persistNow() {
		if (!player.duration) return;
		progress.save({
			tmdbId: context.tmdbId,
			type: context.type,
			title: context.title,
			originalTitle: context.originalTitle,
			poster: art?.poster,
			backdrop: art?.backdrop,
			season: context.seasonNumber,
			episode: context.episodeNumber,
			episodeTitle: context.episodeTitle,
			positionSec: player.currentTime,
			durationSec: player.duration
		});
	}

	$effect(() => {
		// Чтение currentTime внутри таймера не подписывает эффект — таймер
		// выполняется вне синхронного прохода, поэтому цикла здесь нет.
		const id = setInterval(() => {
			if (!player.paused) persist();
		}, 5000);
		return () => clearInterval(id);
	});

	// Отчёт о позиции при закрытии вкладки — иначе прогресс потеряется.
	$effect(() => {
		const onLeave = () => {
			persist();
			player.destroy();
		};
		window.addEventListener('pagehide', onLeave);
		return () => window.removeEventListener('pagehide', onLeave);
	});

	// Пауза — тоже момент выхода: человек может просто закрыть вкладку следом.
	$effect(() => {
		if (player.paused) persist();
	});

	// Иконка полного экрана должна отражать реальное состояние, а не наши догадки.
	$effect(() => {
		const sync = () => (isFullscreen = Boolean(document.fullscreenElement));
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});

	/* ------------------------------ показ панели ---------------------------- */

	function wake() {
		controlsVisible = true;
		if (hideTimer) clearTimeout(hideTimer);
		// Пока открыты настройки или стоит пауза — панель не прячем.
		if (settingsOpen || player.paused) return;
		hideTimer = setTimeout(() => (controlsVisible = false), 3200);
	}

	$effect(() => {
		// Пауза всегда возвращает панель.
		if (player.paused) {
			controlsVisible = true;
			if (hideTimer) clearTimeout(hideTimer);
		}
	});

	/* ------------------------------- клавиатура ----------------------------- */

	/**
	 * Клавиши плеера.
	 *
	 * Раньше это был свой обработчик окна со словарём действий. Переведено на
	 * общий реестр по двум причинам: список клавиш теперь показывается панелью
	 * подсказки (и не может с ней разойтись), а Escape корректно достаётся
	 * верхнему слою — открытым настройкам, а не сразу всему плееру.
	 *
	 * Каждое действие после себя показывает панель управления: нажатие клавиши —
	 * это взаимодействие, и прятать элементы управления в этот момент неправильно.
	 */
	function withWake(fn: () => void): () => void {
		return () => {
			fn();
			wake();
		};
	}

	/** Смена скорости шагами по готовому набору, а не произвольным числом. */
	function stepRate(dir: 1 | -1) {
		const i = PLAYBACK_RATES.indexOf(player.playbackRate as (typeof PLAYBACK_RATES)[number]);
		const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, i + dir))];
		if (next) player.setRate(next);
	}

	/** Субтитры одной клавишей: первые доступные или выключить. */
	function toggleSubtitles() {
		const list = player.source?.subtitles ?? [];
		if (!list.length) return;
		player.selectSubtitle(player.activeSubtitleId ? null : list[0].id);
	}

	/**
	 * Открытая панель настроек — отдельный слой поверх плеера: Escape должен
	 * закрывать её, а не сворачивать полный экран. Раньше это была строка в общем
	 * словаре клавиш, и порядок разбора зависел от порядка ключей в объекте.
	 */
	$effect(() => {
		if (!settingsOpen) return;
		return registerKeys({
			id: 'player-settings',
			priority: 60,
			bindings: [
				{
					combos: ['Escape'],
					hint: 'Esc',
					title: 'Закрыть настройки',
					group: 'Плеер',
					hidden: true,
					run: () => (settingsOpen = false)
				}
			]
		});
	});

	$effect(() =>
		registerKeys({
			id: 'player',
			priority: 10,
			bindings: [
				{
					combos: [' ', 'k'],
					hint: 'Пробел / K',
					title: 'Пауза и продолжение',
					group: 'Плеер',
					run: withWake(() => player.togglePlay())
				},
				{
					combos: ['ArrowRight', 'l'],
					hint: '→ / L',
					title: 'Вперёд на 10 секунд',
					group: 'Плеер',
					run: withWake(() => skip(10))
				},
				{
					combos: ['ArrowLeft', 'j'],
					hint: '← / J',
					title: 'Назад на 10 секунд',
					group: 'Плеер',
					run: withWake(() => skip(-10))
				},
				{
					combos: [',', '.'],
					hint: ', и .',
					title: 'Шаг на кадр назад и вперёд',
					group: 'Плеер',
					// 1/24 секунды — шаг кинокадра. Покадрового доступа в браузере нет,
					// но для поиска нужного момента этого достаточно. Направление берём
					// из самой клавиши: запятая назад, точка вперёд.
					run: (e) => {
						player.seek(player.currentTime + (e.key === ',' ? -1 : 1) / 24);
						wake();
					}
				},
				{
					combos: ['ArrowUp'],
					hint: '↑',
					title: 'Громче',
					group: 'Плеер',
					run: withWake(() => player.setVolume(player.volume + 0.1))
				},
				{
					combos: ['ArrowDown'],
					hint: '↓',
					title: 'Тише',
					group: 'Плеер',
					run: withWake(() => player.setVolume(player.volume - 0.1))
				},
				{
					combos: ['m'],
					hint: 'M',
					title: 'Выключить и включить звук',
					group: 'Плеер',
					run: withWake(() => player.toggleMute())
				},
				{
					combos: ['f'],
					hint: 'F',
					title: 'Полный экран',
					group: 'Плеер',
					run: withWake(() => void player.toggleFullscreen(container))
				},
				{
					combos: ['p'],
					hint: 'P',
					title: 'Картинка в картинке',
					group: 'Плеер',
					run: withWake(() => void player.togglePip())
				},
				{
					combos: ['c'],
					hint: 'C',
					title: 'Субтитры',
					group: 'Плеер',
					run: withWake(toggleSubtitles)
				},
				{
					combos: ['s'],
					hint: 'S',
					title: 'Настройки: качество, озвучка, скорость',
					group: 'Плеер',
					run: withWake(() => (settingsOpen = !settingsOpen))
				},
				{
					combos: ['>'],
					hint: '>',
					title: 'Быстрее',
					group: 'Плеер',
					run: withWake(() => stepRate(1))
				},
				{
					combos: ['<'],
					hint: '<',
					title: 'Медленнее',
					group: 'Плеер',
					run: withWake(() => stepRate(-1))
				},
				{
					combos: ['Home'],
					hint: 'Home',
					title: 'В начало',
					group: 'Плеер',
					run: withWake(() => player.seek(0))
				},
				{
					combos: ['End'],
					hint: 'End',
					title: 'В конец',
					group: 'Плеер',
					run: withWake(() => player.seek(Math.max(0, player.duration - 5)))
				},
				{
					combos: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
					hint: '0 … 9',
					title: 'Перейти на 0–90% длительности',
					group: 'Плеер',
					// Привычка из YouTube: цифра — это доля фильма, а не номер главы.
					run: (e) => {
						if (!player.duration) return;
						player.seek((Number(e.key) / 10) * player.duration);
						wake();
					}
				},
				{
					combos: ['n'],
					hint: 'N',
					title: 'Следующая серия',
					group: 'Плеер',
					run: withWake(() => {
						if (nextHref && !partyLocked) goWithParty(nextHref);
					})
				},
				{
					combos: ['?'],
					hint: '?',
					title: 'Показать горячие клавиши',
					group: 'Общее',
					run: () => keyHelp.toggle()
				}
			]
		})
	);

	/* -------------------------------- таймлайн ------------------------------ */

	let scrubbing = $state(false);
	let hoverRatio = $state<number | null>(null);

	/**
	 * Позиция под пальцем во время перетаскивания.
	 *
	 * Это и была причина «ползунок не двигается»: полоса рисовалась по
	 * player.currentTime, а он обновляется событием timeupdate от <video>. В HLS
	 * после seek видео сначала догружает сегмент и только потом сообщает новое
	 * время — на длинном фильме это заметная пауза, и полоса всё это время стояла
	 * на месте, хотя палец уже уехал.
	 *
	 * Теперь во время перетаскивания UI живёт по dragRatio (мгновенно, без сети),
	 * а сам seek уходит ОДИН раз на отпускании. Побочный выигрыш: раньше seek
	 * летел на каждое движение мыши и заставлял плеер дёргать буфер десятки раз.
	 */
	let dragRatio = $state<number | null>(null);

	function ratioFromEvent(e: PointerEvent, el: HTMLElement): number {
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	function onTimelinePointerDown(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		scrubbing = true;
		dragRatio = ratioFromEvent(e, el);
	}

	function onTimelinePointerMove(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		hoverRatio = ratioFromEvent(e, el);
		// Во время перетаскивания только двигаем полосу — в видео не лезем.
		if (scrubbing) dragRatio = hoverRatio;
	}

	function onTimelinePointerUp(e: PointerEvent) {
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		if (scrubbing && dragRatio != null && player.duration) {
			player.seek(dragRatio * player.duration);
		}
		scrubbing = false;
		dragRatio = null;
	}

	/* ------------------------------- превью кадра --------------------------- */

	/** Позиция спрайта Trickplay для времени под курсором. */
	const preview = $derived.by(() => {
		const tp = player.source?.trickplay;
		if (!tp || hoverRatio == null || !player.duration) return null;

		const timeMs = hoverRatio * player.duration * 1000;
		const globalIndex = Math.floor(timeMs / tp.intervalMs);
		const perTile = tp.tileWidth * tp.tileHeight;
		const tileIndex = Math.floor(globalIndex / perTile);
		const within = globalIndex % perTile;

		return {
			url: tp.tileUrlTemplate.replace('{index}', String(tileIndex)),
			x: -(within % tp.tileWidth) * tp.width,
			y: -Math.floor(within / tp.tileWidth) * tp.height,
			w: tp.width,
			h: tp.height,
			time: hoverRatio * player.duration
		};
	});

	const activeSubtitle = $derived(
		player.source?.subtitles.find((s) => s.id === player.activeSubtitleId)
	);

	const segmentLabel = $derived.by(() => {
		switch (player.activeSegment?.type) {
			case 'Outro':
				return 'Пропустить титры';
			case 'Recap':
				return 'Пропустить повтор';
			case 'Preview':
				return 'Пропустить анонс';
			default:
				return 'Пропустить заставку';
		}
	});

	/* ------------------------------ подписи ------------------------------- */

	const heading = $derived(
		context.type === 'show' && context.seasonNumber
			? `${context.title} · S${context.seasonNumber}E${context.episodeNumber}`
			: context.title
	);

	const nextHref = $derived.by(() => {
		const n = context.nextEpisode;
		if (!n) return null;
		// Тот же путь, только другие номера — слаг берём из адреса возврата.
		return `${backHref.split('?')[0]}/watch?s=${n.seasonNumber}&e=${n.episodeNumber}`;
	});

	/* -------------------------- автопереход к следующей ------------------------- */

	/**
	 * Отсчёт стартует в последние секунды серии. Отмена действует до конца этой
	 * серии; перемотка назад или пауза возвращают автопереход — решение было
	 * осознанным.
	 */
	const AUTOPLAY_WINDOW_SEC = 10;
	let nextCountdown = $state<number | null>(null);
	let nextCancelled = $state(false);

	const autoNextActive = $derived(
		nextHref != null &&
			player.status === 'ready' &&
			!player.paused &&
			player.duration > 60 &&
			player.duration - player.displayTime <= AUTOPLAY_WINDOW_SEC &&
			// В комнате серию двигает только хост — гости идут за его goto.
			(!inParty() || isHost())
	);

	// Новая серия — чистый лист для отсчёта.
	$effect(() => {
		targetKey;
		nextCountdown = null;
		nextCancelled = false;
	});

	// Вышли из окна отсчёта (пауза, перемотка назад) — отмена снимается.
	$effect(() => {
		if (!autoNextActive) nextCancelled = false;
	});

	$effect(() => {
		if (!autoNextActive || nextCancelled) {
			nextCountdown = null;
			return;
		}
		const href = nextHref!;
		const startedAt = Date.now();
		nextCountdown = AUTOPLAY_WINDOW_SEC;
		const id = setInterval(() => {
			const left = Math.max(0, AUTOPLAY_WINDOW_SEC - Math.floor((Date.now() - startedAt) / 1000));
			nextCountdown = left;
			if (left === 0) {
				clearInterval(id);
				goWithParty(href);
			}
		}, 250);
		return () => clearInterval(id);
	});

	/* --------------------------- совместный просмотр --------------------------- */

	let partySetupOpen = $state(false);
	let partyPanelOpen = $state(false);
	/** Не-хосту закрыты озвучка, раздача и переход к следующей серии. */
	const partyLocked = $derived(inParty() && !isHost());
	let joinAttempted: string | null = null;

	/** Что сообщить комнате о текущем воспроизведении (создание/вход). */
	function partySnapshot(): RoomSnapshot {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('room');
		const q = params.size ? `?${params}` : '';
		return {
			targetHref: page.url.pathname + q,
			positionSec: player.currentTime,
			paused: player.paused,
			translationLabel: player.activeTranslation?.label ?? null,
			torrent: player.source?.provider === 'torrent' ? player.source.mediaSourceId : null
		};
	}

	// Зашли по ссылке-приглашению (?room=CODE) — подключаемся сами.
	$effect(() => {
		const code = page.url.searchParams.get('room');
		if (!code || code === joinAttempted || inParty() || party.status === 'connecting') return;
		joinAttempted = code;
		void partyJoin(code, savedName() || 'Гость', null).catch(() => {
			// Комнаты нет — убираем код из адреса, чтобы не зациклиться.
			const u = new URL(location.href);
			u.searchParams.delete('room');
			history.replaceState(history.state, '', u);
		});
	});

	// Ушли со страницы просмотра (не на другую серию) — покидаем комнату.
	beforeNavigate(({ to }) => {
		if (!inParty()) return;
		if (!to?.url.pathname.endsWith('/watch')) partyLeave();
	});

	// Локальные действия видео отправляем в комнату.
	$effect(() => {
		const v = videoEl;
		if (!v) return;
		const onPlay = () => {
			if (party.status === 'in-room') sendState(false, player.currentTime);
		};
		const onPause = () => {
			if (party.status === 'in-room') sendState(true, player.currentTime);
		};
		const onSeeked = () => {
			if (party.status === 'in-room') sendSeek(v.currentTime);
		};
		const onWaiting = () => sendBuffering(true);
		const onPlaying = () => sendBuffering(false);
		v.addEventListener('play', onPlay);
		v.addEventListener('pause', onPause);
		v.addEventListener('seeked', onSeeked);
		v.addEventListener('waiting', onWaiting);
		v.addEventListener('playing', onPlaying);
		return () => {
			v.removeEventListener('play', onPlay);
			v.removeEventListener('pause', onPause);
			v.removeEventListener('seeked', onSeeked);
			v.removeEventListener('waiting', onWaiting);
			v.removeEventListener('playing', onPlaying);
		};
	});

	// Применяем чужие пауза/пуск/перемотка. Свои сообщения не применяем.
	// stateBy='server' приходит с welcome/реконнекта — это состояние комнаты,
	// его обязаны применить, даже если мы сами его последним меняли.
	$effect(() => {
		const st = party.roomState;
		const by = party.stateBy;
		if (!st || !by || (by !== 'server' && by === party.selfId) || party.status !== 'in-room')
			return;
		// Пауза безопасна в любом состоянии источника — применяем сразу, иначе
		// событие потеряется, пока гость переподключает поток.
		if (st.paused && !player.paused) {
			applyRemote(true, st.positionSec, () => void videoEl?.pause());
		}
		if (player.status !== 'ready') return;
		if (!st.paused && player.paused) {
			applyRemote(false, st.positionSec, () => void player.play());
		}
		const shared = sharedPosition();
		if (Math.abs(shared - player.currentTime) > 1.5) {
			applyRemote(st.paused, shared, () => player.seek(shared));
		}
	});

	// Источник догрузился (или вошли в комнату на готовом) — выравниваемся.
	$effect(() => {
		if (player.status !== 'ready' || !inParty()) return;
		const st = untrack(() => party.roomState);
		if (!st) return;
		// Гость на другой раздаче, чем хост, — переходим (иначе озвучка и
		// позиции будут жить своей жизнью). Озвучка-эффект это тоже делает,
		// но там нужен label, а здесь выравниваемся и без него.
		const myHash = player.source?.provider === 'torrent' ? player.source.mediaSourceId : null;
		if (st.torrent && myHash !== st.torrent && !isHost()) {
			player.switchTorrent(st.torrent);
			return;
		}
		const shared = untrack(() => sharedPosition());
		if (st.paused && !player.paused) applyRemote(true, shared, () => void videoEl?.pause());
		else if (!st.paused && player.paused) applyRemote(false, shared, () => void player.play());
		if (Math.abs(shared - player.currentTime) > 1.5) {
			applyRemote(st.paused, shared, () => player.seek(shared));
		}
	});

	// Отстающий (плохой интернет) догоняет комнату, остальные его не ждут.
	$effect(() => {
		if (party.status !== 'in-room') return;
		const id = setInterval(() => {
			if (player.status !== 'ready' || player.paused) return;
			const st = party.roomState;
			if (!st || st.paused) return;
			const shared = sharedPosition();
			if (Math.abs(shared - player.currentTime) > 3) {
				applyRemote(false, shared, () => player.seek(shared));
				pushToast('Синхронизация: догоняем комнату');
			}
		}, 1000);
		return () => clearInterval(id);
	});

	// Озвучку выбирает хост — повторяем за ним (зависим и от списка дорожек:
	// источник может догрузиться позже самого события).
	let dubWarnLabel = '';
	$effect(() => {
		const by = party.translationBy;
		const st = party.roomState;
		const label = st?.translationLabel;
		if (!by || by === party.selfId || !label || party.status === 'idle') return;
		// Пока источник не готов, переключение только навредит (гонка с load).
		// Эффект перезапустится, когда статус и дорожки изменятся.
		if (player.status !== 'ready' || !player.translations.length) return;

		// У хоста и гостя раздачи могут различаться — тогда дорожки не сойдутся
		// никогда. Переходим на раздачу хоста; эффект перезапустится на новом списке.
		const myHash = player.source?.provider === 'torrent' ? player.source.mediaSourceId : null;
		if (st?.torrent && myHash !== st.torrent && !isHost()) {
			player.switchTorrent(st.torrent);
			return;
		}

		// Дорожки сравниваем нестрого: формат подписей у разных раздач плавает.
		const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
		const want = norm(label);
		const match =
			player.translations.find((t) => t.label === label) ??
			player.translations.find((t) => {
				const l = norm(t.label);
				return l.includes(want) || want.includes(l);
			});
		if (match) {
			if (match.id !== player.activeTranslationId) void player.switchTranslation(match.id);
			return;
		}
		if (dubWarnLabel !== label) {
			dubWarnLabel = label;
			pushToast('Не удалось переключить озвучку: её нет в вашем источнике');
		}
	});

	// Хост сменил фильм/серию — переходим за ним.
	$effect(() => {
		const st = party.roomState;
		const by = party.stateBy;
		if (!st || !by || by === party.selfId || party.status === 'idle' || !st.targetHref) return;
		const targetUrl = new URL(st.targetHref, page.url.origin);
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('room');
		const here = page.url.pathname + (params.size ? `?${params}` : '');
		const there = targetUrl.pathname + (targetUrl.searchParams.size ? `?${targetUrl.searchParams}` : '');
		if (here !== there) void goto(withPartyParams(st.targetHref));
	});

	/** Переход, синхронный для комнаты: хост объявляет его всем. */
	function goWithParty(href: string) {
		if (inParty() && isHost()) sendGoto(href);
		void goto(withPartyParams(href));
	}

	let partyCount = $state(0);

	// Отсчёт «3-2-1» для синхронного старта.
	$effect(() => {
		const until = party.countdownUntil;
		if (!until) {
			partyCount = 0;
			return;
		}
		let fired = false;
		const tick = () => {
			const leftMs = until - Date.now();
			partyCount = Math.max(0, Math.ceil(leftMs / 1000));
			if (leftMs <= 0 && !fired) {
				fired = true;
				const shared = sharedPosition();
				applyRemote(false, shared, () => {
					player.seek(shared);
					void player.play();
				});
			}
		};
		tick();
		const id = setInterval(tick, 200);
		return () => clearInterval(id);
	});

	/** Горизонтальная позиция всплывающей реакции — детерминированно по id автора. */
	function reactLeft(id: string): number {
		let h = 0;
		for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 1000;
		return 15 + (h % 60);
	}

	$effect(() => {
		if (party.status === 'idle') partyPanelOpen = false;
	});

	/* Чат свёрнут — сообщения на несколько секунд всплывают поверх видео. */
	let chatPopups = $state<{ id: string; name: string; text: string }[]>([]);
	let chatSeen = -1;

	$effect(() => {
		const log = party.chatLog;
		const len = log.length;
		if (party.status === 'idle') {
			chatSeen = -1;
			chatPopups = [];
			return;
		}
		if (chatSeen === -1) {
			// Первое срабатывание в комнате: историю не показываем.
			chatSeen = len;
			return;
		}
		if (len <= chatSeen) {
			chatSeen = len;
			return;
		}
		const fresh = log.slice(chatSeen);
		chatSeen = len;
		if (partyPanelOpen) return;
		for (const m of fresh) {
			if (m.self) continue;
			chatPopups = [...chatPopups, { id: m.id, name: m.name, text: m.text }];
			setTimeout(() => {
				chatPopups = chatPopups.filter((p) => p.id !== m.id);
			}, 4500);
		}
	});

	/** Подпись текущего качества: при «Авто» показываем, что реально играет. */
	const qualityLabel = $derived.by(() => {
		if (!player.levels.length) return null;
		if (player.levelIndex === -1) {
			return player.activeHeight ? `Авто · ${player.activeHeight}p` : 'Авто';
		}
		const level = player.levels.find((l) => l.index === player.levelIndex);
		return level ? `${level.height}p` : 'Авто';
	});

	const bufferRatio = $derived(player.duration ? player.buffered / player.duration : 0);

	/**
	 * Позиция полосы. Приоритет: палец > цель перемотки > фактическое время.
	 *
	 * Средний случай важен не меньше первого. Раньше на отпускании мыши палец
	 * «отпускался», а фактическое время ещё оставалось старым — полоса на секунду
	 * отпрыгивала назад, и перемотка выглядела сорвавшейся. Теперь до самого
	 * приезда видео полоса стоит в целевой точке (см. pendingSeekTime).
	 */
	const playedRatio = $derived(dragRatio ?? player.progressRatio);

	const shownTime = $derived(
		dragRatio != null && player.duration ? dragRatio * player.duration : player.displayTime
	);

	/* --------------------------- жесты на мобильном ------------------------- */

	let lastTap = 0;

	/**
	 * Двойное касание по краю — перемотка, как в мобильных плеерах.
	 * Одиночное — пауза, но с задержкой: иначе первое касание двойного тапа
	 * успевает поставить паузу.
	 */
	function onVideoPointerUp(e: PointerEvent) {
		if (e.pointerType === 'mouse') {
			player.togglePlay();
			return;
		}

		const now = Date.now();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const zone = (e.clientX - rect.left) / rect.width;

		if (now - lastTap < 300) {
			if (zone < 0.35) skip(-10);
			else if (zone > 0.65) skip(10);
			else player.togglePlay();
			lastTap = 0;
			wake();
			return;
		}

		lastTap = now;
		setTimeout(() => {
			if (lastTap && Date.now() - lastTap >= 300) {
				controlsVisible ? (controlsVisible = false) : wake();
				lastTap = 0;
			}
		}, 320);
	}
</script>

<!--
	Кнопка перемотки. Число внутри иконки, а не в подписи: пользователь жаловался,
	что по круговой стрелке непонятно, на сколько мотает. Общий набор иконок
	рисует только пути, поэтому цифра тут инлайном.
-->
{#snippet seekButton(delta: number)}
	<button
		type="button"
		onclick={() => skip(delta)}
		class="pctl"
		aria-label={delta < 0 ? 'Назад на 10 секунд' : 'Вперёд на 10 секунд'}
		title={delta < 0 ? 'Назад на 10 секунд' : 'Вперёд на 10 секунд'}
	>
		<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none">
			<g
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
				transform={delta < 0 ? '' : 'scale(-1 1) translate(-24 0)'}
			>
				<!-- Незамкнутая дуга со стрелкой: направление читается сразу. -->
				<path d="M4.2 11.5a8 8 0 1 1 2.6 6.6" />
				<path d="M3.6 6.4v5.2h5.2" />
			</g>
			<text
				x="12"
				y="15.4"
				text-anchor="middle"
				font-size="8.5"
				font-weight="700"
				fill="currentColor"
				font-family="Inter Tight, system-ui, sans-serif"
			>
				10
			</text>
		</svg>
	</button>
{/snippet}


<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-dvh w-full overflow-hidden bg-black">
<div
	bind:this={container}
	class="relative h-full min-w-0 flex-1 select-none overflow-hidden bg-black"
	onpointermove={wake}
	onpointerleave={() => (hoverRatio = null)}
	style="cursor: {controlsVisible ? 'default' : 'none'}"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoEl}
		class="h-full w-full bg-black object-contain"
		playsinline
		preload="auto"
		onpointerup={onVideoPointerUp}
	>
		{#if activeSubtitle}
			<track
				kind="subtitles"
				src={activeSubtitle.url}
				srclang={activeSubtitle.language ?? 'ru'}
				label={activeSubtitle.label}
				default
			/>
		{/if}
	</video>

	<!-- ========================== экран ожидания ========================== -->
	{#if player.status === 'loading' || player.status === 'switching'}
		<div class="absolute inset-0 overflow-hidden">
			{#if art?.backdrop}
				<!-- Кадр тайтла вместо чёрного экрана. Сильно размытый и притемнённый:
				     это фон ожидания, а не показ контента. -->
				<img
					src={art.backdrop}
					alt=""
					class="loading-backdrop h-full w-full scale-105 object-cover opacity-40 blur-xl"
				/>
			{/if}
			<div class="absolute inset-0 bg-canvas/75"></div>

			<div class="absolute inset-0 grid place-items-center px-6">
				<div class="flex max-w-md flex-col items-center text-center">
					{#if art?.poster}
						<div class="mb-6">
							<img
								src={art.poster}
								alt=""
								class="block h-40 w-auto rounded-md shadow-4 ring-1 ring-white/10"
							/>
						</div>
					{/if}

					<p class="mb-4 font-display text-lg text-ink">{heading}</p>

					<div class="mb-3 h-[3px] w-44 overflow-hidden rounded-full bg-white/12">
						<!-- Полоса неопределённого прогресса: сколько ждать, мы не знаем,
						     а честный индикатор лучше врущего процента. -->
						<div class="loading-bar h-full w-1/3 bg-accent"></div>
					</div>

					<p
						class="loading-status flex items-center text-[13px] text-dim"
						role="status"
						aria-live="polite"
					>
						<span>{loadingLabel}</span>
						<span class="loading-dots ml-1" aria-hidden="true">
							<span></span><span></span><span></span>
						</span>
					</p>

					{#if player.errorMessage}
						<p class="mt-1.5 text-[11.5px] text-warn">{player.errorMessage}</p>
					{/if}
				</div>
			</div>
		</div>
	{:else if player.status === 'error'}
		<div class="absolute inset-0 grid place-items-center bg-canvas/92 p-6">
			<div class="max-w-md text-center">
				<p class="mb-2 font-display text-xl text-ink">Не удалось воспроизвести</p>
				<p class="mb-6 text-[13.5px] leading-relaxed text-dim">{player.errorMessage}</p>
				<div class="flex flex-wrap items-center justify-center gap-2.5">
					<button
						type="button"
						onclick={() => player.load(target)}
						class="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm
						       font-semibold text-accent-ink transition hover:bg-accent-hover"
					>
						<Icon name="play" size={15} />
						Ещё раз
					</button>
					<a
						href={backHref}
						class="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5
						       text-sm text-ink transition hover:border-line-strong"
					>
						<Icon name="chevronLeft" size={15} />
						К описанию
					</a>
				</div>
			</div>
		</div>
	{/if}

	<!-- ========================= подсказка перемотки ======================= -->
	{#if seekHint}
		<!--
			Показываем накопленный шаг у того края, куда мотаем. Появляется поверх
			кадра и гаснет сама — так работает перемотка во всех мобильных плеерах,
			и именно этой обратной связи не хватало.
		-->
		{#key seekHint.id}
			<div
				class="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2
				       {seekHint.delta < 0 ? 'left-[12%]' : 'right-[12%]'}"
			>
				<div
					class="flex animate-[seekpop_0.9s_ease-out_forwards] flex-col items-center gap-1.5
					       rounded-full border border-white/15 bg-black/60 px-5 py-4 backdrop-blur-md"
				>
					<span class="text-white">
						<Icon name={seekHint.delta < 0 ? 'rewind' : 'forward'} size={26} />
					</span>
					<span class="tnum whitespace-nowrap text-[13px] font-semibold text-white">
						{seekHint.delta > 0 ? '+' : '−'}{Math.abs(seekHint.delta)}
						{secondsWord(Math.abs(seekHint.delta))}
					</span>
				</div>
			</div>
		{/key}
	{/if}

	<!-- ====================== индикатор занятости ========================== -->
	{#if player.status === 'ready' && player.seeking && !player.paused}
		<!--
			Пока догружается сегмент после перемотки, плеер должен показывать, что он
			работает. Без этого пауза в полсекунды читается как «зависло», и человек
			жмёт перемотку ещё раз, делая только хуже.
		-->
		<div class="pointer-events-none absolute inset-0 z-10 grid place-items-center">
			<span
				class="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-accent"
				aria-label="Перемотка"
			></span>
		</div>
	{/if}

	<!-- ===================== центральная кнопка на паузе =================== -->
	{#if player.status === 'ready' && player.paused}
		<button
			type="button"
			onclick={() => player.togglePlay()}
			aria-label="Продолжить"
			class="absolute left-1/2 top-1/2 z-10 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2
			       place-items-center rounded-full border border-white/20 bg-black/45 text-white
			       backdrop-blur-md transition hover:scale-105 hover:bg-black/65"
			style="box-shadow: var(--glow-md)"
		>
			<Icon name="play" size={30} />
		</button>
	{/if}

	<!-- ====================== пропуск заставки/титров ====================== -->
	{#if player.activeSegment && player.status === 'ready' && nextCountdown == null}
		<button
			type="button"
			onclick={() => player.skipSegment()}
			class="absolute bottom-32 right-[var(--gutter)] z-20 inline-flex h-11 items-center gap-2
			       rounded-full border border-white/25 bg-black/70 px-5 text-sm font-semibold text-white
			       backdrop-blur-md transition hover:border-white/50 hover:bg-black/90"
		>
			{segmentLabel}
			<Icon name="chevronRight" size={15} />
		</button>
	{/if}

	<!-- ====================== автопереход к следующей серии ================= -->
	{#if nextCountdown != null && nextHref && context.nextEpisode}
		<div
			class="absolute bottom-32 right-[var(--gutter)] z-30 w-80 max-w-[calc(100vw-2rem)]
			       rounded-lg border border-white/15 bg-black/80 p-4 backdrop-blur-xl"
		>
			<p class="text-[11px] font-semibold uppercase tracking-wider text-white/50">
				Следующая серия через {nextCountdown} {secondsWord(nextCountdown)}
			</p>
			<p class="mt-1 truncate text-sm font-semibold text-white">
				S{context.nextEpisode.seasonNumber}E{context.nextEpisode.episodeNumber}
				{#if context.nextEpisode.name}· {context.nextEpisode.name}{/if}
			</p>
			<div class="mt-3 flex gap-2">
				<button
					type="button"
					onclick={() => goWithParty(nextHref)}
					class="h-9 flex-1 rounded-full bg-accent text-[13px] font-semibold text-accent-ink
					       transition hover:bg-accent-hover"
				>
					Смотреть сейчас
				</button>
				<button
					type="button"
					onclick={() => {
						nextCancelled = true;
						nextCountdown = null;
					}}
					class="h-9 rounded-full border border-white/20 px-4 text-[13px] text-white/80
					       transition hover:border-white/45"
				>
					Отмена
				</button>
			</div>
			<div class="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
				<div
					class="h-full bg-accent transition-[width] duration-1000 ease-linear"
					style="width: {(1 - nextCountdown / AUTOPLAY_WINDOW_SEC) * 100}%"
				></div>
			</div>
		</div>
	{/if}

	<!-- ============================ верхняя полоса ========================= -->
	<div
		class="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85
		       to-transparent px-[var(--gutter)] pb-16 pt-4 transition-opacity duration-[var(--t-mid)]"
		style="opacity: {controlsVisible ? 1 : 0}"
	>
		<div class="pointer-events-auto flex items-start gap-3">
			<a
				href={backHref}
				class="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15
				       bg-black/40 text-white backdrop-blur-md transition hover:bg-black/70"
				aria-label="Назад к описанию"
			>
				<Icon name="chevronLeft" size={20} />
			</a>

			<div class="min-w-0 flex-1 pt-0.5">
				<p class="truncate font-display text-[15px] text-white md:text-lg">{context.title}</p>
				{#if context.type === 'show' && context.seasonNumber}
					<p class="mt-0.5 truncate text-[12px] text-white/60">
						Сезон {context.seasonNumber}, серия {context.episodeNumber}
						{#if context.episodeTitle}· {context.episodeTitle}{/if}
					</p>
				{/if}
			</div>

			{#if inParty()}
				<span
					class="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/40
					       bg-black/40 px-2.5 py-1 text-[11px] text-emerald-300 backdrop-blur-md sm:flex"
					title="Смотрят вместе: {party.peers.map((p) => p.name).join(', ')}"
				>
					<Icon name="users" size={12} />
					{party.peers.length}
				</span>
			{/if}

			{#if qualityLabel}
				<span
					class="tnum hidden shrink-0 rounded-full border border-white/15 bg-black/40 px-2.5
					       py-1 text-[11px] text-white/70 backdrop-blur-md sm:block"
				>
					{qualityLabel}
				</span>
			{/if}
		</div>
	</div>

	<!-- ============================ нижняя панель ========================== -->
	<div
		class="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/92 via-black/55
		       to-transparent px-[var(--gutter)] pb-4 pt-20 transition-opacity duration-[var(--t-mid)]"
		style="opacity: {controlsVisible ? 1 : 0}; pointer-events: {controlsVisible ? 'auto' : 'none'}"
	>
		<!-- ------------------------------ таймлайн ------------------------------ -->
		<div class="group/bar relative mb-2">
			{#if preview && !scrubbing}
				<!-- Превью кадра. Trickplay приходил с сервера и раньше не использовался. -->
				<div
					class="pointer-events-none absolute bottom-8 z-30 -translate-x-1/2 overflow-hidden
					       rounded-md border border-white/15 shadow-4"
					style="left: {(hoverRatio ?? 0) * 100}%"
				>
					<div
						style="width: {preview.w}px; height: {preview.h}px;
						       background-image: url({preview.url});
						       background-position: {preview.x}px {preview.y}px"
					></div>
					<p class="tnum bg-black/85 py-0.5 text-center text-[11px] text-white">
						{formatTime(preview.time)}
					</p>
				</div>
			{:else if hoverRatio != null && player.duration}
				<span
					class="tnum pointer-events-none absolute bottom-6 z-30 -translate-x-1/2 rounded
					       bg-black/85 px-1.5 py-0.5 text-[11px] text-white"
					style="left: {hoverRatio * 100}%"
				>
					{formatTime(hoverRatio * player.duration)}
				</span>
			{/if}

			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				role="slider"
				tabindex="0"
				aria-label="Позиция воспроизведения"
				aria-valuemin={0}
				aria-valuemax={Math.round(player.duration)}
				aria-valuenow={Math.round(player.currentTime)}
				onpointerdown={onTimelinePointerDown}
				onpointermove={onTimelinePointerMove}
				onpointerup={onTimelinePointerUp}
				class="relative flex h-6 cursor-pointer items-center"
			>
				<div class="relative h-[3px] w-full rounded-full bg-white/20 transition-all
				            group-hover/bar:h-[5px]">
					<!-- Буфер -->
					<div
						class="absolute inset-y-0 left-0 rounded-full bg-white/25"
						style="width: {bufferRatio * 100}%"
					></div>

					<!-- Отметки заставки и титров -->
					{#each player.source?.segments ?? [] as seg (seg.startSec)}
						{#if player.duration && seg.startSec < player.duration}
							<div
								class="absolute inset-y-0 bg-warn/45"
								style="left: {(seg.startSec / player.duration) * 100}%;
								       width: {(Math.max(
										0,
										Math.min(seg.endSec, player.duration) - seg.startSec
									) /
										player.duration) * 100}%"
								title={seg.type === 'Outro' ? 'Титры' : 'Заставка'}
							></div>
						{/if}
					{/each}

					<!-- Прогресс -->
					<div
						class="absolute inset-y-0 left-0 rounded-full bg-accent"
						style="width: {playedRatio * 100}%"
					></div>

					<!-- Кружок -->
					<div
						class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full
						       bg-accent transition-opacity group-hover/bar:opacity-100
						       {scrubbing ? 'opacity-100' : 'opacity-0'}"
						style="left: {playedRatio * 100}%; box-shadow: var(--glow-sm)"
					></div>
				</div>
			</div>
		</div>

		<!-- ------------------------------- кнопки ------------------------------- -->
		<div class="flex items-center gap-1.5">
			<button
				type="button"
				onclick={() => player.togglePlay()}
				class="pctl"
				aria-label={player.paused ? 'Воспроизвести' : 'Пауза'}
			>
				<Icon name={player.paused ? 'play' : 'pause'} size={20} />
			</button>

			{@render seekButton(-10)}
			{@render seekButton(10)}

			{#if nextHref && !partyLocked}
				<button
					type="button"
					onclick={() => goWithParty(nextHref)}
					class="pctl"
					aria-label="Следующая серия"
					title="Следующая серия"
				>
					<Icon name="next" size={18} />
				</button>
			{/if}

			<!-- Громкость: ползунок раскрывается по наведению, чтобы не занимать место -->
			<div class="group/vol hidden items-center sm:flex">
				<button
					type="button"
					onclick={() => player.toggleMute()}
					class="pctl"
					aria-label={player.muted ? 'Включить звук' : 'Выключить звук'}
				>
					<Icon name="volume" size={19} />
				</button>
				<div
					class="w-0 overflow-hidden transition-all duration-[var(--t-mid)] group-hover/vol:w-24
					       group-focus-within/vol:w-24"
				>
					<input
						type="range"
						min="0"
						max="1"
						step="0.02"
						value={player.muted ? 0 : player.volume}
						oninput={(e) => player.setVolume(Number(e.currentTarget.value))}
						class="range ml-1 w-24"
						style="--fill: {(player.muted ? 0 : player.volume) * 100}%"
						aria-label="Громкость"
					/>
				</div>
			</div>

			<span class="tnum ml-1.5 shrink-0 text-[12.5px] text-white/75">
				{formatTime(shownTime)}
				<span class="text-white/35"> / {formatTime(player.duration)}</span>
			</span>

			<div class="ml-auto flex items-center gap-1.5">
				{#if player.playbackRate !== 1}
					<span class="tnum text-[11px] text-accent">{player.playbackRate}×</span>
				{/if}

				<!-- ===================== совместный просмотр ===================== -->
				<div class="relative">
					<button
						type="button"
						onclick={() => {
							if (inParty()) partyPanelOpen = !partyPanelOpen;
							else partySetupOpen = !partySetupOpen;
						}}
						class="pctl relative {(inParty() && partyPanelOpen) || (!inParty() && partySetupOpen)
							? 'bg-white/15'
							: ''}"
						aria-label="Смотреть вместе"
						title="Смотреть вместе"
					>
						<Icon name="users" size={19} />
						{#if inParty()}
							<span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
						{/if}
						{#if party.unread > 0}
							<span
								class="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full
								       bg-accent px-1 text-[9.5px] font-bold leading-none text-accent-ink"
							>
								{party.unread}
							</span>
						{/if}
					</button>

					{#if partySetupOpen && !inParty()}
						<PartySetup snapshot={partySnapshot} onClose={() => (partySetupOpen = false)} />
					{/if}
				</div>

				<!-- ========================= панель настроек ======================= -->
				<div class="relative">
					<button
						type="button"
						onclick={() => (settingsOpen = !settingsOpen)}
						aria-expanded={settingsOpen}
						class="pctl {settingsOpen ? 'bg-white/15' : ''}"
						aria-label="Настройки"
					>
						<Icon name="sliders" size={19} />
					</button>

					{#if settingsOpen}
						<!-- Одна панель на всё: качество, озвучка, субтитры, скорость. -->
						<div
							class="absolute bottom-full right-0 z-30 mb-3 max-h-[60vh] w-72 overflow-y-auto
							       rounded-md border border-white/12 bg-canvas/97 py-2 shadow-4
							       backdrop-blur-xl"
						>
							{#if player.levels.length}
								<p class="psection">
									<Icon name="layers" size={13} />
									Качество
								</p>
								<button
									type="button"
									onclick={() => player.setQuality('auto')}
									class="pitem {player.levelIndex === -1 ? 'pitem-on' : ''}"
								>
									<span class="flex-1">Авто</span>
									{#if player.levelIndex === -1 && player.activeHeight}
										<span class="tnum text-[11px] text-white/40">{player.activeHeight}p</span>
									{/if}
									{#if player.levelIndex === -1}<Icon name="check" size={14} />{/if}
								</button>
								{#each player.levels as level (level.index)}
									<button
										type="button"
										onclick={() => player.setQuality(level.height)}
										class="pitem {player.levelIndex === level.index ? 'pitem-on' : ''}"
									>
										<span class="tnum flex-1">{level.height}p</span>
										<span class="tnum text-[11px] text-white/35">
											{Math.round(level.bitrate / 1000)} кбит/с
										</span>
										{#if player.levelIndex === level.index}<Icon name="check" size={14} />{/if}
									</button>
								{/each}
							{/if}

							{#if player.torrentOptions.length > 1}
								<p class="psection">
									<Icon name="magnet" size={13} />
									Раздача · качество
									{#if partyLocked}<span class="ml-auto text-[10px] font-normal text-white/40">Выбирает хост</span>{/if}
								</p>
								{#each player.torrentOptions as o (o.hash)}
									<button
										type="button"
										disabled={partyLocked}
										onclick={() => player.switchTorrent(o.hash)}
										class="pitem {o.hash === player.source?.mediaSourceId ? 'pitem-on' : ''}
										       {partyLocked ? 'opacity-50' : ''}"
									>
										{#if o.quality}
											<span class="tnum rounded bg-white/10 px-1 text-[10px] font-semibold uppercase leading-4">
												{o.quality}
											</span>
										{/if}
										<span class="flex-1 truncate leading-snug" title={o.title}>{o.title}</span>
										{#if o.seeders > 0}
											<span class="tnum text-[11px] text-white/35">▲{o.seeders}</span>
										{/if}
										{#if o.hash === player.source?.mediaSourceId}<Icon name="check" size={14} />{/if}
									</button>
								{/each}
							{/if}

							{#if player.translations.length > 1}
								<p class="psection">
									<Icon name="volume" size={13} />
									Озвучка
									{#if partyLocked}<span class="ml-auto text-[10px] font-normal text-white/40">Выбирает хост</span>{/if}
								</p>
								{#each player.translations as t (t.id)}
									<button
										type="button"
										disabled={partyLocked}
										onclick={() => {
											if (inParty() && isHost()) {
												const hash =
													player.source?.provider === 'torrent' ? player.source.mediaSourceId : null;
												sendTranslation(t.label, hash);
											}
											void player.switchTranslation(t.id);
										}}
										class="pitem {t.id === player.activeTranslationId ? 'pitem-on' : ''}
										       {partyLocked ? 'opacity-50' : ''}"
									>
										<span class="flex-1 leading-snug">{t.label}</span>
										{#if t.id === player.activeTranslationId}<Icon name="check" size={14} />{/if}
									</button>
								{/each}
							{/if}

							{#if player.source?.subtitles.length}
								<p class="psection">
									<Icon name="subtitles" size={13} />
									Субтитры
								</p>
								<button
									type="button"
									onclick={() => player.selectSubtitle(null)}
									class="pitem {!player.activeSubtitleId ? 'pitem-on' : ''}"
								>
									<span class="flex-1">Выключены</span>
									{#if !player.activeSubtitleId}<Icon name="check" size={14} />{/if}
								</button>
								{#each player.source.subtitles as s (s.id)}
									<button
										type="button"
										onclick={() => player.selectSubtitle(s.id)}
										class="pitem {s.id === player.activeSubtitleId ? 'pitem-on' : ''}"
									>
										<span class="flex-1 leading-snug">{s.label}</span>
										{#if s.id === player.activeSubtitleId}<Icon name="check" size={14} />{/if}
									</button>
								{/each}
							{/if}

							<p class="psection">
								<Icon name="gauge" size={13} />
								Скорость
							</p>
							<div class="flex flex-wrap gap-1.5 px-3 pb-1.5 pt-0.5">
								{#each PLAYBACK_RATES as rate (rate)}
									<button
										type="button"
										onclick={() => player.setRate(rate)}
										class="tnum h-8 min-w-11 rounded-full border px-2 text-xs transition
										       {player.playbackRate === rate
											? 'border-accent bg-accent font-semibold text-accent-ink'
											: 'border-white/15 text-white/70 hover:border-white/35'}"
									>
										{rate}×
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<button
					type="button"
					onclick={() => void player.togglePip()}
					class="pctl hidden md:grid"
					aria-label="Картинка в картинке"
				>
					<Icon name="pip" size={19} />
				</button>

				<button
					type="button"
					onclick={() => void player.toggleFullscreen(container)}
					class="pctl"
					aria-label={isFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
				>
					<Icon name={isFullscreen ? 'fullscreenExit' : 'fullscreen'} size={19} />
				</button>
			</div>
		</div>
	</div>

	<!-- ======================= оверлеи совместного просмотра ======================= -->

	<!-- Всплывающие реакции: поднимаются снизу вверх и гаснут. -->
	{#if party.reactions.length}
		<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
			{#each party.reactions as r (r.id)}
				<div
					class="party-float absolute bottom-36 flex flex-col items-center"
					style="left: {reactLeft(r.id)}%"
				>
					<span class="text-3xl drop-shadow-lg">{r.emoji}</span>
					<span class="mt-0.5 max-w-24 truncate text-[10px] text-white/70">{r.name}</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Тосты комнаты: снизу слева, исчезают сами. -->
	{#if party.toasts.length}
		<div class="pointer-events-none absolute bottom-36 left-[var(--gutter)] z-40 flex flex-col gap-2">
			{#each party.toasts as t (t.id)}
				<div class="rounded-full border border-white/15 bg-black/80 px-4 py-2 text-[13px] text-white backdrop-blur-md">
					{t.text}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Отсчёт синхронного старта. -->
	{#if partyCount > 0}
		<div class="pointer-events-none absolute inset-0 z-40 grid place-items-center">
			<div class="grid h-28 w-28 place-items-center rounded-full border-2 border-accent bg-black/70 backdrop-blur-md">
				<span class="tnum font-display text-5xl text-white">{partyCount}</span>
			</div>
		</div>
	{/if}

	<!-- Переподключение после обрыва связи. -->
	{#if party.status === 'reconnecting'}
		<div
			class="absolute right-[var(--gutter)] top-16 z-40 rounded-full border border-white/15
			       bg-black/75 px-4 py-2 text-[12px] text-white/80 backdrop-blur-md"
		>
			Связь с комнатой потеряна — переподключаемся…
		</div>
	{/if}

	<!-- Чат свернут: новые сообщения ненадолго всплывают справа внизу. -->
	{#if chatPopups.length}
		<div class="pointer-events-none absolute bottom-36 right-[var(--gutter)] z-40 flex flex-col items-end gap-2">
			{#each chatPopups as cp (cp.id)}
				<div
					class="party-popup max-w-72 rounded-lg border border-white/15 bg-black/80 px-3 py-2
					       backdrop-blur-md"
				>
					<p class="text-[11px] font-semibold text-accent">{cp.name}</p>
					<p class="mt-0.5 break-words text-[13px] leading-snug text-white/90">{cp.text}</p>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Кик: хост исключил из комнаты. -->
	{#if party.kicked}
		<div class="absolute inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm">
			<div class="w-80 max-w-full rounded-lg border border-white/15 bg-canvas p-6 text-center">
				<p class="font-display text-base text-white">Хост исключил вас из комнаты</p>
				<p class="mt-2 text-[13px] text-white/55">Прогресс сохранён — можно досмотреть одному.</p>
				<button
					type="button"
					onclick={() => (party.kicked = false)}
					class="mt-5 h-10 w-full rounded-full bg-accent text-[13px] font-semibold text-accent-ink
					       transition hover:bg-accent-hover"
				>
					Продолжить одному
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Панель комнаты стоит рядом с видео и не перекрывает его. -->
{#if partyPanelOpen && inParty()}
	<PartyPanel onClose={() => (partyPanelOpen = false)} />
{/if}
</div>

<style>
	/*
	  Локальные классы, а не утилиты: эти три набора повторяются в разметке по
	  десять раз каждый, и в атрибутах они превращали строки классов в кашу.
	*/
	.pctl {
		display: grid;
		place-items: center;
		height: 2.5rem;
		width: 2.5rem;
		flex-shrink: 0;
		border-radius: 999px;
		color: #fff;
		transition:
			background-color 0.2s var(--ease-out-quint),
			transform 0.2s var(--ease-out-quint);
	}

	.pctl:hover {
		background: rgb(255 255 255 / 0.15);
		transform: scale(1.06);
	}

	.psection {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.65rem 0.75rem 0.35rem;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgb(255 255 255 / 0.38);
	}

	.pitem {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-size: 0.8125rem;
		color: rgb(255 255 255 / 0.82);
		transition: background-color 0.15s;
	}

	.pitem:hover {
		background: rgb(255 255 255 / 0.09);
	}

	.pitem-on {
		color: var(--c-accent);
		font-weight: 600;
	}

	/* Подсказка перемотки: появляется рывком и гаснет, не требуя внимания. */
	@keyframes seekpop {
		0% {
			opacity: 0;
			transform: scale(0.9);
		}
		18% {
			opacity: 1;
			transform: scale(1);
		}
		70% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: scale(0.97);
		}
	}

	.loading-backdrop {
		animation: loading-backdrop 4.8s ease-in-out infinite alternate;
	}

	.loading-bar {
		animation: indeterminate 1.25s ease-in-out infinite;
		box-shadow: 0 0 12px rgb(var(--c-glow) / 0.38);
	}

	.loading-status {
		min-height: 1.25rem;
	}

	.loading-dots {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.loading-dots > span {
		width: 3px;
		height: 3px;
		border-radius: 999px;
		background: currentColor;
		animation: loading-dot 1.05s ease-in-out infinite;
	}

	.loading-dots > span:nth-child(2) {
		animation-delay: 0.14s;
	}

	.loading-dots > span:nth-child(3) {
		animation-delay: 0.28s;
	}

	@keyframes loading-backdrop {
		from {
			transform: scale(1.05);
			opacity: 0.32;
		}
		to {
			transform: scale(1.09);
			opacity: 0.44;
		}
	}

	@keyframes loading-dot {
		0%, 70%, 100% {
			transform: translateY(0);
			opacity: 0.35;
		}
		35% {
			transform: translateY(-3px);
			opacity: 1;
		}
	}

	/* Полоса ожидания: бежит слева направо, не обещая процентов. */
	@keyframes indeterminate {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(300%);
		}
	}

	/* Реакции комнаты: всплывают и гаснут, как в стриминговых чатах. */
	@keyframes party-float {
		0% {
			opacity: 0;
			transform: translateY(12px) scale(0.7);
		}
		12% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateY(-56px) scale(1.05);
		}
	}

	.party-float {
		animation: party-float 1.9s ease-out forwards;
	}

	/* Сообщение чата поверх видео: появляется и растворяется. */
	@keyframes party-popup {
		0% {
			opacity: 0;
			transform: translateY(8px);
		}
		8%, 82% {
			opacity: 1;
			transform: translateY(0);
		}
		100% {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	.party-popup {
		animation: party-popup 4.5s ease-out both;
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-backdrop,
		.loading-bar,
		.loading-dots > span {
			animation: none;
		}
	}
</style>
