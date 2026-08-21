/**
 * Контроллер плеера.
 *
 * Главная сложность, вокруг которой всё построено: Jellyfin отдаёт HLS-манифест
 * ровно с ОДНОЙ аудиодорожкой. Поэтому «сменить озвучку» — это не переключение
 * трека внутри плеера, а полная пересборка источника:
 *
 *   запомнить позицию -> запросить новый манифест с другим audioStreamIndex ->
 *   -> переподключить hls.js -> вернуться на запомненную позицию -> продолжить
 *
 * Пользователь видит короткую паузу вместо мгновенного переключения. Ровно так же
 * ведёт себя оригинал, где каждая озвучка — отдельный манифест.
 *
 * У CDN-источников (Cobalt/Titan/Carbon) каждая озвучка — отдельный URL, и все
 * они приезжают одним ответом (Translation.url). Там переключение происходит
 * локально, без похода на сервер. Carbon отдаёт DASH — подключаем dash.js.
 */

import type { MediaType, PlaybackProvider, PlaybackSource, Translation } from '$lib/types';

type Hls = import('hls.js').default;

/** Минимальный кусок API dash.js, которым пользуемся. */
interface DashPlayer {
	initialize(video: HTMLVideoElement, url: string, autoplay: boolean): void;
	on(event: 'error', cb: (e: { error?: { message?: string } | string }) => void): void;
	reset(): void;
}

export interface PlayerTarget {
	type: MediaType;
	tmdbId: number;
	season?: number;
	episode?: number;
}

/** Один уровень качества из манифеста. */
export interface QualityLevel {
	/** Индекс в hls.levels — именно им переключаются. */
	index: number;
	height: number;
	bitrate: number;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const PROGRESS_INTERVAL_MS = 10_000;

const PREFS_KEY = 'kinema:player:v1';

/**
 * Пользовательские настройки плеера.
 *
 * Качество запоминаем ВЫСОТОЙ, а не индексом уровня: индексы у каждого манифеста
 * свои, и «уровень 2» в следующем фильме означает совсем другое разрешение.
 */
interface PlayerPrefs {
	volume: number;
	muted: boolean;
	rate: number;
	qualityHeight: number | null;
}

const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false, rate: 1, qualityHeight: null };

function readPrefs(): PlayerPrefs {
	if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
	try {
		const raw = localStorage.getItem(PREFS_KEY);
		return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PlayerPrefs>) } : { ...DEFAULT_PREFS };
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

export class PlayerController {
	/* ------------------------------- состояние ------------------------------ */
	video = $state<HTMLVideoElement | null>(null);
	source = $state<PlaybackSource | null>(null);

	status = $state<'idle' | 'loading' | 'ready' | 'switching' | 'error'>('idle');
	errorMessage = $state<string | null>(null);

	paused = $state(true);
	currentTime = $state(0);

	/**
	 * Куда мы попросили перемотать, пока видео туда не доехало.
	 *
	 * Нужно, чтобы полоса и часы не отпрыгивали назад. После seek браузер меняет
	 * currentTime не сразу: сначала догружается сегмент, и только потом приходит
	 * timeupdate с новым временем. Без этого поля интерфейс на секунду возвращался
	 * в старую точку — выглядело так, будто перемотка не сработала.
	 */
	pendingSeekTime = $state<number | null>(null);
	/** Идёт перемотка — плееру нужно показать, что он занят, а не завис. */
	seeking = $state(false);
	duration = $state(0);
	buffered = $state(0);
	volume = $state(1);
	muted = $state(false);

	activeTranslationId = $state<string | null>(null);
	activeSubtitleId = $state<string | null>(null);
	/** Сдвиг субтитров в секундах — бывает нужен, когда дорожка не совпадает с релизом. */
	subtitleOffset = $state(0);

	/* --------------------------- качество и скорость ------------------------ */

	/** Уровни манифеста, от высокого к низкому. Пусто — выбирать нечего. */
	levels = $state<QualityLevel[]>([]);
	/** Выбранный уровень. -1 значит «Авто». */
	levelIndex = $state(-1);
	/** Что реально играет сейчас — при «Авто» это меняется само. */
	activeHeight = $state(0);
	playbackRate = $state(1);

	private prefs: PlayerPrefs = readPrefs();

	private hls: Hls | null = null;
	private dash: DashPlayer | null = null;
	private progressTimer: ReturnType<typeof setInterval> | null = null;
	private target: PlayerTarget | null = null;
	private destroyed = false;

	/* ------------------------------ производные ----------------------------- */

	get translations(): Translation[] {
		return this.source?.translations ?? [];
	}

	get activeTranslation(): Translation | undefined {
		return this.translations.find((t) => t.id === this.activeTranslationId);
	}

	/** Активный сегмент (заставка/титры) для кнопки «Пропустить». */
	get activeSegment() {
		const t = this.currentTime;
		return this.source?.segments.find((s) => t >= s.startSec && t < s.endSec - 1) ?? null;
	}

	get progressRatio(): number {
		return this.duration > 0 ? this.displayTime / this.duration : 0;
	}

	/** Время, которое видит пользователь: цель перемотки, если она в процессе. */
	get displayTime(): number {
		return this.pendingSeekTime ?? this.currentTime;
	}

	/* -------------------------------- загрузка ------------------------------- */

	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private retryCount = 0;
	private static readonly MAX_AUTO_RETRIES = 12;
	/** Источники, чей поток доказанно мёртв (404/410 на сегментах) — пропускаем при повторе. */
	private deadProviders = new Set<PlaybackProvider>();

	async load(
		target: PlayerTarget,
		opts: {
			audioStreamIndex?: number;
			autoRetry?: boolean;
			/**
			 * Позиция, с которой начать, если сервер её не знает. Локальный
			 * прогресс из браузера: на Vercel Jellyfin не подключён, и
			 * startPositionSec оттуда приходит нулевым — без этого «продолжить
			 * просмотр» начинал бы с начала.
			 */
			resumeSec?: number;
		} = {}
	): Promise<void> {
		this.clearRetryTimer();
		// Ручной запуск (кнопка, эффект) даёт новую серию автоповторов.
		if (!opts.autoRetry) {
			this.retryCount = 0;
			this.deadProviders.clear();
		}
		this.target = target;
		// Контроллер переиспользуется после перемонтирования (SvelteKit обновляет
		// data и эффект дёргается повторно) — снимаем «ядовитый» флаг destroy,
		// иначе load молча выйдёт после fetch и статус застрянет на switching.
		this.destroyed = false;
		this.status = this.source ? 'switching' : 'loading';
		this.errorMessage = null;

		// При смене озвучки возвращаемся ровно туда, где были.
		const resumeAt = this.source ? this.currentTime : undefined;

		try {
			const res = await fetch('/api/playback/resolve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: target.type,
					tmdbId: target.tmdbId,
					season: target.season,
					episode: target.episode,
					audioStreamIndex: opts.audioStreamIndex,
					startPositionSec: resumeAt,
					exclude: [...this.deadProviders]
				})
			});

			if (!res.ok) {
				const detail = await res.json().catch(() => null);
				throw new Error(detail?.message ?? `Сервер ответил ${res.status}`);
			}

			const source = (await res.json()) as PlaybackSource;
			if (this.destroyed) return;

			this.source = source;
			this.activeTranslationId = source.activeTranslationId;

			/*
				Порядок важен. resumeAt — смена озвучки на ходу, там позиция точнее
				всего. Дальше позиция сервера (Jellyfin знает её и для других
				устройств), и только потом локальная: она у каждого браузера своя.
			*/
			const serverPos = source.startPositionSec && source.startPositionSec > 1 ? source.startPositionSec : undefined;
			await this.attach(source, resumeAt ?? serverPos ?? opts.resumeSec ?? 0);
			this.status = 'ready';
			this.retryCount = 0;
			this.startProgressReporting();

			// Стартуем сразу: переход на страницу просмотра — это жест
			// пользователя, политику автовоспроизведения он удовлетворяет.
			void this.play();
		} catch (e) {
			if (this.destroyed) return;
			const msg = e instanceof Error ? e.message : 'Не удалось загрузить поток';
			this.teardownMedia();

			// Временный сбой upstream (их API бывает лежит) — переподробуем сами:
			// как только сервис оживёт, фильм начнётся без участия пользователя.
			// «Этого тайтла нет в CDN» — детерминированный отказ, ретрай бессмыслен.
			const transient =
				/временно не ответили|Сервер ответил 5\d\d|не отдаёт HLS-манифест/.test(msg);
			if (transient && this.retryCount < PlayerController.MAX_AUTO_RETRIES) {
				this.retryCount += 1;
				this.status = 'loading';
				this.errorMessage = `CDN не отвечает, переподключаемся… (попытка ${this.retryCount})`;
				this.retryTimer = setTimeout(
					() => void this.load(target, { ...opts, autoRetry: true }),
					15_000
				);
				return;
			}

			this.status = 'error';
			this.errorMessage = msg;
		}
	}

	private clearRetryTimer(): void {
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}

	/**
	 * Поток оборвался посреди просмотра: движок сам не поднялся.
	 * Пересобираем источник целиком и возвращаемся на текущую позицию.
	 * Возвращает false, если вмешательство не нужно — видео ещё играет.
	 */
	private scheduleStreamRetry(): boolean {
		if (this.destroyed || !this.target) return false;

		// Движок сообщил об ошибке, но видео продолжает идти из буфера —
		// пересборка только прервёт работающий просмотр. Вмешиваемся, лишь
		// когда воспроизведение реально встало.
		const v = this.video;
		if (v && !v.paused && !v.ended && v.readyState >= 2) return false;

		if (this.retryTimer) return true;

		if (this.retryCount >= PlayerController.MAX_AUTO_RETRIES) {
			this.status = 'error';
			this.errorMessage = 'Поток оборвался и не восстановился';
			return true;
		}

		const resumeAt = this.currentTime;
		this.teardownMedia();
		// Сбрасываем source: иначе load() примет позицию за «смену озвучки»,
		// а resumeAt=0 перешибёт локальную позицию из opts.resumeSec.
		this.source = null;
		this.retryCount += 1;
		this.status = 'loading';
		this.errorMessage = `Поток оборвался, переподключаемся… (попытка ${this.retryCount})`;
		this.retryTimer = setTimeout(
			() => void this.load(this.target!, { autoRetry: true, resumeSec: resumeAt }),
			5_000
		);
		return true;
	}

	/** Переключение озвучки. Публичный вход — им пользуется UI. */
	async switchTranslation(translationId: string): Promise<void> {
		const next = this.translations.find((t) => t.id === translationId);
		if (!next || !this.target || next.id === this.activeTranslationId) return;

		const wasPlaying = !this.paused;

		// CDN-источники привозят все манифесты сразу — переключаемся на месте.
		if (next.url) {
			const resumeAt = this.currentTime;
			this.status = 'switching';
			this.errorMessage = null;
			this.activeTranslationId = next.id;
			try {
				if (this.source) this.source = { ...this.source, streamUrl: next.url };
				await this.attach({ ...this.source, streamUrl: next.url } as PlaybackSource, resumeAt);
				this.status = 'ready';
				if (wasPlaying) void this.play();
			} catch (e) {
				this.status = 'error';
				this.errorMessage = e instanceof Error ? e.message : 'Не удалось переключить озвучку';
			}
			return;
		}

		await this.load(this.target, { audioStreamIndex: next.audioStreamIndex });

		// Пользователь смотрел — пусть смотрит дальше, без лишнего клика.
		if (wasPlaying) void this.play();
	}

	private async attach(source: PlaybackSource, startAt: number): Promise<void> {
		const video = this.video;
		if (!video) return;

		/*
		 * Быстрый путь: тот же движок, другой манифест.
		 *
		 * Так выглядит смена озвучки у источников, где каждая дорожка — отдельный
		 * манифест. Раньше здесь всегда шёл полный teardown: destroy() рвёт worker
		 * hls.js, отсоединяет MediaSource и выбрасывает трансмуксер, а следующий
		 * new Hls() поднимает всё это заново. Именно это и было заметной паузой при
		 * переключении — а не загрузка самого манифеста.
		 *
		 * loadSource() на живом инстансе переиспользует и worker, и привязку к
		 * <video>: меняется только источник.
		 */
		const wantsHls = source.streamUrl.includes('.m3u8');
		if (wantsHls && this.hls && !this.dash) {
			// Уровни принадлежат манифесту — у нового они свои.
			this.levels = [];
			this.activeHeight = 0;

			const hls = this.hls;
			// Импорт уже в кеше модулей — обращение к enum событий бесплатное.
			const { default: HlsCtor } = await import('hls.js');

			const ready = new Promise<void>((resolve) => {
				let settled = false;
				const done = () => {
					if (settled) return;
					settled = true;
					resolve();
				};
				// Ждём разбора нового манифеста, иначе seek уйдёт в старый буфер.
				hls.once(HlsCtor.Events.MANIFEST_PARSED, done);
				// Страховка: если манифест не разобрался, не висим вечно.
				setTimeout(done, 4000);
			});

			hls.loadSource(source.streamUrl);
			await ready;
			await this.seekWhenReady(video, startAt);
			return;
		}

		this.teardownMedia();

		// Carbon отдаёт DASH-манифесты (.mpd) — их тянет dash.js.
		if (source.streamUrl.includes('.mpd')) {
			const { default: dashjs } = await import('dashjs');
			const dash = dashjs.MediaPlayer().create() as unknown as DashPlayer;
			dash.on('error', (e) => {
				// 404/410/403 на сегментах — копия в CDN мертва насовсем, повтор
				// ничего не даст: помечаем источник, чтобы уйти на следующий (торренты).
				const msg = typeof e.error === 'string' ? e.error : (e.error?.message ?? '');
				if (/not available|\b40[34]\b|\b410\b/i.test(msg)) this.deadProviders.add('scrapers');
				// dash.js часто сообщает об ошибке одной из репрезентаций, продолжая
				// играть из буфера. Даём 2 секунды: если просмотр идёт — не лезем.
				setTimeout(() => {
					if (this.dash !== dash) return; // инстанс уже заменён
					this.scheduleStreamRetry();
				}, 2_000);
			});
			dash.initialize(video, source.streamUrl, false);
			this.dash = dash;
			await this.seekWhenReady(video, startAt);
			return;
		}

		const isHls = source.streamUrl.includes('.m3u8');

		if (isHls) {
			// HLS всегда через hls.js, где есть MSE: нативный декодер части
			// сборок Chromium парсит манифест (длительность есть), но не играет
			// MPEG-TS — получается чёрный экран. hls.js трансмуксит TS в fMP4
			// и кормит MSE — это работает одинаково во всех браузерах.
			// Нативно — только там, где MSE нет.
			const { default: HlsCtor } = await import('hls.js');

			if (HlsCtor.isSupported()) {
				// У торрентов переписываем несовместимую метку аудиокодека в манифестах.
				const loader =
					source.provider === 'torrent' ? makeTorrentManifestLoader(HlsCtor) : undefined;
				const hls = new HlsCtor({
					...(loader && { loader }),
					// Больше запас — меньше рискуем упереться в буфер на медленном канале.
					maxBufferLength: 30,
					maxMaxBufferLength: 90,
					backBufferLength: 30,
					enableWorker: true,
					/*
					 * Ускорение старта. Честно про предел: основное время до первого
					 * кадра съедает не плеер, а ответ резолвера и загрузка манифеста.
					 * Здесь убирается только то, что зависит от нас.
					 */
					// Тянем следующий фрагмент, не дожидаясь начала воспроизведения.
					startFragPrefetch: true,
					// По умолчанию hls.js считает канал медленным (500 кбит/с) и
					// раскачивается несколько фрагментов. Ставим реалистичнее.
					abrEwmaDefaultEstimate: 1_200_000,
					// Дыры в буфере на склейках сегментов не должны вставать в ступор.
					maxBufferHole: 0.5,
					// Торрент-транскодер на слабом VPS отдаёт сегменты медленнее
					// реального времени — повторов нужно больше обычного.
					fragLoadingMaxRetry: 8,
					manifestLoadingMaxRetry: 3
				});

				// Не считаем источник готовым, пока браузер действительно не разобрал
				// манифест. Раньше attach() возвращался сразу, экран ожидания исчезал,
				// а заблокированный CDN бесконечно перезапускал hls.js в фоне.
				const manifestReady = new Promise<void>((resolve, reject) => {
					let settled = false;
					let timer: ReturnType<typeof setTimeout>;
					const finish = (action: () => void) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						action();
					};

					hls.once(HlsCtor.Events.MANIFEST_PARSED, () => finish(resolve));
					hls.on(HlsCtor.Events.ERROR, (_event, data) => {
						if (!data.fatal) return;
						if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
							finish(() => reject(new Error(hlsNetworkMessage(data.response?.code))));
						} else {
							// Например, несовместимые кодеки — ждать таймаута бессмысленно.
							finish(() => reject(new Error('Поток не поддерживается этим браузером')));
						}
					});
					// Торрент-раздаче на холодном старте нужно время поднять транскодер —
					// 12 секунд ей мало, остальным источникам хватает с запасом.
					timer = setTimeout(
						() => finish(() => reject(new Error('CDN слишком долго не отдаёт HLS-манифест'))),
						source.provider === 'torrent' ? 60_000 : 12_000
					);
				});

				// Уровни известны только после разбора манифеста.
				hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
					this.levels = hls.levels
						.map((l, index) => ({ index, height: l.height ?? 0, bitrate: l.bitrate ?? 0 }))
						.filter((l) => l.height > 0)
						.sort((a, b) => b.height - a.height);

					// Применяем запомненное качество, если такая высота тут есть.
					const want = this.prefs.qualityHeight;
					const match = want ? this.levels.find((l) => l.height === want) : undefined;
					if (match) {
						hls.currentLevel = match.index;
						this.levelIndex = match.index;
					} else {
						this.levelIndex = -1;
					}
				});

				hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
					this.activeHeight = hls.levels[data.level]?.height ?? 0;
				});

				hls.on(HlsCtor.Events.ERROR, (_e, data) => {
					if (!data.fatal) return;
					// Внутренние повторы hls.js уже исчерпаны. startLoad() здесь создавал
					// бесконечный цикл при 403/CORS вместо понятной ошибки пользователю.
					if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
						if (data.response?.code === 401 || data.response?.code === 403) {
							hls.stopLoad();
							this.status = 'error';
							this.errorMessage = hlsNetworkMessage(data.response.code);
						} else if (!this.scheduleStreamRetry()) {
							// Видео ещё играет из буфера — просто продолжаем тянуть.
							hls.startLoad();
						}
					}
					else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
					else {
						this.scheduleStreamRetry();
					}
				});

				hls.loadSource(source.streamUrl);
				hls.attachMedia(video);
				this.hls = hls;
				await manifestReady;
			} else if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
				// Safari и прочие браузеры с настоящим нативным HLS.
				video.src = source.streamUrl;
			} else {
				throw new Error('Браузер не поддерживает HLS');
			}
		} else {
			video.src = source.streamUrl;
		}

		await this.seekWhenReady(video, startAt);
	}

	/** Ставит позицию, дождавшись готовности метаданных. */
	private seekWhenReady(video: HTMLVideoElement, seconds: number): Promise<void> {
		if (seconds <= 0) return Promise.resolve();

		return new Promise((resolve) => {
			const apply = () => {
				try {
					video.currentTime = seconds;
				} catch {
					// Поток ещё не принимает seek — не критично, продолжим с нуля.
				}
				resolve();
			};

			if (video.readyState >= 1) apply();
			else video.addEventListener('loadedmetadata', apply, { once: true });
		});
	}

	/* -------------------------------- контролы ------------------------------- */

	async play(): Promise<void> {
		try {
			await this.video?.play();
		} catch {
			// Автовоспроизведение заблокировано политикой браузера — ждём жеста.
		}
	}

	pause(): void {
		this.video?.pause();
	}

	togglePlay(): void {
		if (this.paused) void this.play();
		else this.pause();
	}

	seek(seconds: number): void {
		if (!this.video || !Number.isFinite(seconds)) return;
		const target = Math.max(0, Math.min(seconds, this.duration || seconds));

		// Цель фиксируем сразу: интерфейс должен встать в новую точку в тот же
		// кадр, не дожидаясь, пока догрузится сегмент.
		this.pendingSeekTime = target;
		this.seeking = true;
		this.video.currentTime = target;
	}

	skipBy(delta: number): void {
		this.seek(this.currentTime + delta);
	}

	/** Перемотать текущую заставку/титры целиком. */
	skipSegment(): void {
		const segment = this.activeSegment;
		if (segment) this.seek(segment.endSec);
	}

	setVolume(v: number): void {
		const clamped = Math.max(0, Math.min(1, v));
		this.volume = clamped;
		if (this.video) {
			this.video.volume = clamped;
			this.video.muted = clamped === 0;
		}
		this.muted = clamped === 0;
		this.savePrefs();
	}

	toggleMute(): void {
		if (!this.video) return;
		this.muted = !this.muted;
		this.video.muted = this.muted;
		this.savePrefs();
	}

	async togglePip(): Promise<void> {
		if (!this.video || !document.pictureInPictureEnabled) return;
		try {
			if (document.pictureInPictureElement) await document.exitPictureInPicture();
			else await this.video.requestPictureInPicture();
		} catch {
			// Некоторые браузеры запрещают PiP из фонового таба — молча игнорируем.
		}
	}

	async toggleFullscreen(container: HTMLElement | null): Promise<void> {
		if (!container) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await container.requestFullscreen();
		} catch {
			// Отказ в полноэкранном режиме не должен ломать просмотр.
		}
	}

	selectSubtitle(id: string | null): void {
		this.activeSubtitleId = id;
	}

	/**
	 * Выбор качества. 'auto' отдаёт решение ABR обратно.
	 *
	 * Работает только там, где поток идёт через hls.js: при нативном HLS (Safari)
	 * и при DASH уровнями управляет сам браузер или dash.js, и списка у нас нет —
	 * поэтому UI прячет этот пункт, когда levels пуст.
	 */
	setQuality(height: number | 'auto'): void {
		if (!this.hls) return;

		if (height === 'auto') {
			this.hls.currentLevel = -1;
			this.levelIndex = -1;
			this.prefs.qualityHeight = null;
		} else {
			const level = this.levels.find((l) => l.height === height);
			if (!level) return;
			this.hls.currentLevel = level.index;
			this.levelIndex = level.index;
			this.prefs.qualityHeight = height;
		}
		this.savePrefs();
	}

	setRate(rate: number): void {
		this.playbackRate = rate;
		if (this.video) this.video.playbackRate = rate;
		this.prefs.rate = rate;
		this.savePrefs();
	}

	private savePrefs(): void {
		if (typeof localStorage === 'undefined') return;
		this.prefs.volume = this.volume;
		this.prefs.muted = this.muted;
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
		} catch {
			// Приватный режим — настройки просто не переживут перезагрузку.
		}
	}

	/* ---------------------------- события <video> ---------------------------- */

	bindVideo(video: HTMLVideoElement): () => void {
		this.video = video;

		// Возвращаем то, с чем человек смотрел в прошлый раз.
		video.volume = this.prefs.volume;
		video.muted = this.prefs.muted;
		video.playbackRate = this.prefs.rate;
		this.volume = this.prefs.volume;
		this.muted = this.prefs.muted;
		this.playbackRate = this.prefs.rate;

		const onTime = () => (this.currentTime = video.currentTime);
		const onRate = () => (this.playbackRate = video.playbackRate);
		const onSeeking = () => (this.seeking = true);
		const onSeeked = () => {
			// Доехали — отпускаем интерфейс на фактическое время.
			this.pendingSeekTime = null;
			this.seeking = false;
			this.currentTime = video.currentTime;
		};
		// Ждём данных после перемотки: спиннер должен гаснуть по факту, а не по таймеру.
		const onWaiting = () => (this.seeking = true);
		const onPlaying = () => (this.seeking = false);
		const onDuration = () => (this.duration = video.duration || 0);
		const onPlay = () => (this.paused = false);
		const onPause = () => (this.paused = true);
		const onVolume = () => {
			this.volume = video.volume;
			this.muted = video.muted;
		};
		const onProgress = () => {
			const len = video.buffered.length;
			this.buffered = len ? video.buffered.end(len - 1) : 0;
		};
		const onEnded = () => {
			this.paused = true;
			void this.report('stopped');
		};

		video.addEventListener('timeupdate', onTime);
		video.addEventListener('ratechange', onRate);
		video.addEventListener('seeking', onSeeking);
		video.addEventListener('seeked', onSeeked);
		video.addEventListener('waiting', onWaiting);
		video.addEventListener('playing', onPlaying);
		video.addEventListener('durationchange', onDuration);
		video.addEventListener('loadedmetadata', onDuration);
		video.addEventListener('play', onPlay);
		video.addEventListener('pause', onPause);
		video.addEventListener('volumechange', onVolume);
		video.addEventListener('progress', onProgress);
		video.addEventListener('ended', onEnded);

		return () => {
			video.removeEventListener('timeupdate', onTime);
			video.removeEventListener('ratechange', onRate);
			video.removeEventListener('seeking', onSeeking);
			video.removeEventListener('seeked', onSeeked);
			video.removeEventListener('waiting', onWaiting);
			video.removeEventListener('playing', onPlaying);
			video.removeEventListener('durationchange', onDuration);
			video.removeEventListener('loadedmetadata', onDuration);
			video.removeEventListener('play', onPlay);
			video.removeEventListener('pause', onPause);
			video.removeEventListener('volumechange', onVolume);
			video.removeEventListener('progress', onProgress);
			video.removeEventListener('ended', onEnded);
		};
	}

	/* ------------------------------ отчёты в Jellyfin ------------------------ */

	private startProgressReporting(): void {
		this.stopProgressReporting();
		void this.report('start');

		this.progressTimer = setInterval(() => {
			if (!this.paused) void this.report('progress');
		}, PROGRESS_INTERVAL_MS);
	}

	private stopProgressReporting(): void {
		if (this.progressTimer) clearInterval(this.progressTimer);
		this.progressTimer = null;
	}

	private async report(event: 'start' | 'progress' | 'stopped'): Promise<void> {
		const s = this.source;
		if (!s) return;

		const payload = JSON.stringify({
			event,
			itemId: s.jellyfinItemId,
			playSessionId: s.playSessionId,
			mediaSourceId: s.mediaSourceId,
			positionSec: this.currentTime,
			isPaused: this.paused,
			audioStreamIndex: this.activeTranslation?.audioStreamIndex,
			playMethod: s.playMethod
		});

		// На закрытии вкладки обычный fetch не успевает — sendBeacon успевает.
		if (event === 'stopped' && navigator.sendBeacon) {
			navigator.sendBeacon(
				'/api/playback/progress',
				new Blob([payload], { type: 'application/json' })
			);
			return;
		}

		await fetch('/api/playback/progress', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: payload,
			keepalive: event === 'stopped'
		}).catch(() => undefined);
	}

	/* -------------------------------- очистка -------------------------------- */

	private teardownMedia(): void {
		// Уровни принадлежат конкретному манифесту: после пересборки они другие.
		this.levels = [];
		this.activeHeight = 0;

		if (this.hls) {
			this.hls.destroy();
			this.hls = null;
		}
		if (this.dash) {
			this.dash.reset();
			this.dash = null;
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.clearRetryTimer();
		void this.report('stopped');
		this.stopProgressReporting();
		this.teardownMedia();
		this.video = null;
	}
}

function hlsNetworkMessage(code?: number): string {
	if (code === 401 || code === 403) {
		return 'CDN запретил воспроизведение на этом сайте';
	}
	return 'CDN отклонил запрос или не разрешил доступ из браузера';
}

/**
 * TorrServer кодирует звук в AAC Main и честно помечает его mp4a.40.1 — и в
 * манифесте, и в esds init-сегмента. Браузеры через MSE такой профиль не
 * принимают (isTypeSupported = false), и hls.js молча отбрасывает уровень
 * (manifestIncompatibleCodecsError) или не может создать SourceBuffer
 * (bufferAddCodecError). Декодер при этом AAC Main понимает, поэтому метку
 * правим на AAC-LC (mp4a.40.2): в манифестах — строкой, в init-сегменте —
 * байтом objectType в AudioSpecificConfig.
 */
function patchAacMainToLc(bytes: Uint8Array): void {
	// Ищем бокс esds: единственный в init-сегменте, в аудиодорожке.
	let idx = -1;
	for (let i = 0; i + 4 < bytes.length; i++) {
		if (bytes[i] === 0x65 && bytes[i + 1] === 0x73 && bytes[i + 2] === 0x64 && bytes[i + 3] === 0x73) {
			idx = i;
			break;
		}
	}
	if (idx < 0) return;

	let p = idx + 8; // за 'esds' и полем version/flags
	const end = Math.min(idx + 64, bytes.length);
	while (p < end) {
		const tag = bytes[p++];
		let len = 0;
		let m: number;
		let guard = 0;
		do {
			m = bytes[p++];
			len = (len << 7) | (m & 0x7f);
		} while (m & 0x80 && guard++ < 3);
		if (tag === 0x05 && len >= 2) {
			// AudioSpecificConfig: профиль — первые 5 бит. 1 = Main, 2 = LC.
			if (bytes[p] >> 3 === 1) bytes[p] = (2 << 3) | (bytes[p] & 0x07);
			return;
		}
		if (tag === 0x03) {
			p += 3; // ES_Descriptor: ES_ID(2) + флаги(1), дальше вложенные дескрипторы
			continue;
		}
		if (tag === 0x04) {
			p += 13; // DecoderConfig: фиксированные 13 байт, дальше вложенный ASC
			continue;
		}
		p += len;
	}
}

function makeTorrentManifestLoader(HlsCtor: typeof import('hls.js').default) {
	// Типы лоадера у hls.js громоздкие, а нам нужен только перехват onSuccess.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type AnyLoader = new (...args: any[]) => { load(context: any, config: any, callbacks: any): any };
	const Base = HlsCtor.DefaultConfig.loader as unknown as AnyLoader;
	class RewritingLoader extends Base {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		load(context: any, config: any, callbacks: any) {
			const orig = callbacks.onSuccess;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			callbacks.onSuccess = (response: any, stats: any, ctx: any, details: any) => {
				if (typeof response?.data === 'string') {
					response.data = response.data.replaceAll('mp4a.40.1', 'mp4a.40.2');
				} else if (response?.data instanceof ArrayBuffer) {
					patchAacMainToLc(new Uint8Array(response.data));
				}
				if (typeof response?.playlist === 'string') {
					response.playlist = response.playlist.replaceAll('mp4a.40.1', 'mp4a.40.2');
				}
				orig(response, stats, ctx, details);
			};
			return super.load(context, config, callbacks);
		}
	}
	return RewritingLoader as unknown as typeof HlsCtor.DefaultConfig.loader;
}

/** Форматирование времени: 1:02:03 для длинных, 2:03 для коротких. */
export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;

	return h > 0
		? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
		: `${m}:${String(s).padStart(2, '0')}`;
}
