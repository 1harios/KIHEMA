/**
 * Клиент Jellyfin.
 *
 * Живёт только на сервере: токен наружу не отдаём, браузер ходит через наш прокси.
 *
 * Особенности API, из-за которых код выглядит именно так:
 *  - JSON в PascalCase;
 *  - все тайминги в тиках по 100 нс;
 *  - параметр `fields` работает ТОЛЬКО на списочных эндпоинтах, на /Items/{id} его нет;
 *  - искать по значению TMDB ID нельзя (AnyProviderIdEquals в Jellyfin сломан), отсюда свой индекс;
 *  - HLS-манифест содержит одну аудиодорожку, смена озвучки = новый манифест.
 */

import type {
	MediaSegment,
	PlaybackSource,
	PlayMethod,
	SubtitleTrack,
	Translation,
	TrickplayInfo
} from '$lib/types';
import { ticksToSeconds } from '$lib/types';

export interface JellyfinConfig {
	baseUrl: string;
	clientName: string;
	version: string;
}

/* ------------------------------- сырые типы ------------------------------ */

export interface JfMediaStream {
	Type: 'Audio' | 'Video' | 'Subtitle' | 'EmbeddedImage' | 'Data' | 'Lyric';
	Index: number;
	Codec?: string | null;
	Language?: string | null;
	DisplayTitle?: string | null;
	Title?: string | null;
	Channels?: number | null;
	ChannelLayout?: string | null;
	IsDefault?: boolean;
	IsForced?: boolean;
	IsExternal?: boolean;
	IsHearingImpaired?: boolean;
	IsTextSubtitleStream?: boolean;
	DeliveryMethod?: string | null;
	DeliveryUrl?: string | null;
}

export interface JfMediaSource {
	Id: string;
	Name?: string;
	Container?: string;
	RunTimeTicks?: number | null;
	MediaStreams?: JfMediaStream[];
	SupportsDirectPlay?: boolean;
	SupportsDirectStream?: boolean;
	SupportsTranscoding?: boolean;
	TranscodingUrl?: string | null;
	TranscodingSubProtocol?: string | null;
	DefaultAudioStreamIndex?: number | null;
	DefaultSubtitleStreamIndex?: number | null;
}

export interface JfUserData {
	PlaybackPositionTicks?: number;
	PlayedPercentage?: number | null;
	Played?: boolean;
	PlayCount?: number;
	IsFavorite?: boolean;
}

export interface JfItem {
	Id: string;
	Name: string;
	Type: string;
	ProductionYear?: number | null;
	RunTimeTicks?: number | null;
	IndexNumber?: number | null;
	ParentIndexNumber?: number | null;
	SeriesId?: string | null;
	SeriesName?: string | null;
	SeasonId?: string | null;
	Overview?: string | null;
	ProviderIds?: Record<string, string> | null;
	ImageTags?: Record<string, string> | null;
	BackdropImageTags?: string[] | null;
	MediaSources?: JfMediaSource[];
	MediaStreams?: JfMediaStream[];
	UserData?: JfUserData | null;
	Trickplay?: Record<string, Record<string, JfTrickplayInfo>> | null;
	ChildCount?: number | null;
}

interface JfTrickplayInfo {
	Width: number;
	Height: number;
	TileWidth: number;
	TileHeight: number;
	ThumbnailCount: number;
	Interval: number;
	Bandwidth?: number;
}

interface JfQueryResult<T> {
	Items: T[];
	TotalRecordCount: number;
	StartIndex?: number;
}

export class JellyfinError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'JellyfinError';
	}
}

/* ------------------------------- сам клиент ------------------------------ */

export class JellyfinClient {
	constructor(
		private readonly cfg: JellyfinConfig,
		private readonly token?: string,
		private readonly deviceId: string = 'lightstream-server',
		private readonly deviceName: string = 'Kinema Server'
	) {}

	withToken(token: string, deviceId: string, deviceName = 'Kinema Web'): JellyfinClient {
		return new JellyfinClient(this.cfg, token, deviceId, deviceName);
	}

	/**
	 * Заголовок авторизации Jellyfin.
	 * Формат строгий: MediaBrowser Client="..", Device="..", DeviceId="..", Version="..", Token=".."
	 * На логине Token= не передаётся.
	 */
	private authHeader(): string {
		const esc = (v: string) => v.replace(/"/g, '');
		const parts = [
			`Client="${esc(this.cfg.clientName)}"`,
			`Device="${esc(this.deviceName)}"`,
			`DeviceId="${esc(this.deviceId)}"`,
			`Version="${esc(this.cfg.version)}"`
		];
		if (this.token) parts.push(`Token="${esc(this.token)}"`);
		return `MediaBrowser ${parts.join(', ')}`;
	}

	private url(path: string, query: Record<string, unknown> = {}): string {
		const u = new URL(this.cfg.baseUrl.replace(/\/+$/, '') + path);
		for (const [k, v] of Object.entries(query)) {
			if (v === undefined || v === null) continue;
			u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
		}
		return u.toString();
	}

	private async request<T>(
		path: string,
		opts: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}
	): Promise<T> {
		const res = await fetch(this.url(path, opts.query), {
			method: opts.method ?? 'GET',
			headers: {
				Authorization: this.authHeader(),
				Accept: 'application/json',
				...(opts.body ? { 'Content-Type': 'application/json' } : {})
			},
			body: opts.body ? JSON.stringify(opts.body) : undefined
		});

		if (!res.ok) {
			throw new JellyfinError(res.status, `Jellyfin ${res.status} на ${path}`);
		}
		if (res.status === 204) return undefined as T;

		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	/* ------------------------------ авторизация ---------------------------- */

	async authenticate(
		username: string,
		password: string
	): Promise<{ token: string; userId: string; userName: string; isAdmin: boolean }> {
		// Поле пароля называется Pw, не Password — частая ошибка.
		const r = await this.request<{
			AccessToken: string;
			User: { Id: string; Name: string; Policy?: { IsAdministrator?: boolean } };
		}>('/Users/AuthenticateByName', {
			method: 'POST',
			body: { Username: username, Pw: password }
		});

		return {
			token: r.AccessToken,
			userId: r.User.Id,
			userName: r.User.Name,
			isAdmin: Boolean(r.User.Policy?.IsAdministrator)
		};
	}

	/* -------------------------------- каталог ------------------------------ */

	/**
	 * Постраничный обход библиотеки. Используется сборщиком индекса.
	 * `fields=ProviderIds` обязателен — без него TMDB ID в списках не приходит.
	 */
	async listItems(params: {
		userId?: string;
		includeItemTypes: string[];
		startIndex?: number;
		limit?: number;
		fields?: string[];
		sortBy?: string[];
		parentId?: string;
	}): Promise<JfQueryResult<JfItem>> {
		return this.request<JfQueryResult<JfItem>>('/Items', {
			query: {
				userId: params.userId,
				includeItemTypes: params.includeItemTypes,
				recursive: true,
				startIndex: params.startIndex ?? 0,
				limit: params.limit ?? 200,
				fields: params.fields ?? ['ProviderIds'],
				sortBy: params.sortBy,
				parentId: params.parentId,
				enableImages: false
			}
		});
	}

	async getItem(itemId: string, userId?: string): Promise<JfItem> {
		// У этого эндпоинта нет параметра fields — он и так отдаёт полный DTO.
		return this.request<JfItem>(`/Items/${itemId}`, { query: { userId } });
	}

	async getSeasons(seriesId: string, userId?: string): Promise<JfItem[]> {
		const r = await this.request<JfQueryResult<JfItem>>(`/Shows/${seriesId}/Seasons`, {
			query: { userId }
		});
		return r.Items ?? [];
	}

	async getEpisodes(seriesId: string, userId?: string, seasonId?: string): Promise<JfItem[]> {
		const r = await this.request<JfQueryResult<JfItem>>(`/Shows/${seriesId}/Episodes`, {
			query: { userId, seasonId, fields: ['Overview', 'ProviderIds'] }
		});
		return r.Items ?? [];
	}

	async getResume(userId: string, limit = 16): Promise<JfItem[]> {
		const r = await this.request<JfQueryResult<JfItem>>('/UserItems/Resume', {
			query: { userId, limit, mediaTypes: 'Video', fields: ['ProviderIds'] }
		});
		return r.Items ?? [];
	}

	async getNextUp(userId: string, limit = 16): Promise<JfItem[]> {
		const r = await this.request<JfQueryResult<JfItem>>('/Shows/NextUp', {
			query: { userId, limit, fields: ['ProviderIds'] }
		});
		return r.Items ?? [];
	}

	/* ----------------------------- воспроизведение -------------------------- */

	/**
	 * Профиль устройства для браузера.
	 *
	 * Смысл: перечислить то, что браузер играет сам, чтобы Jellyfin отдавал файл
	 * напрямую и не жёг CPU на транскодирование. Всё остальное уедет в HLS.
	 */
	private browserDeviceProfile(maxBitrate: number) {
		return {
			MaxStreamingBitrate: maxBitrate,
			MaxStaticBitrate: maxBitrate,
			DirectPlayProfiles: [
				{
					Container: 'mp4,m4v,webm,mkv',
					Type: 'Video',
					VideoCodec: 'h264,vp8,vp9,av1',
					AudioCodec: 'aac,mp3,opus,vorbis,flac,ac3,eac3'
				}
			],
			TranscodingProfiles: [
				{
					Container: 'ts',
					Type: 'Video',
					VideoCodec: 'h264',
					AudioCodec: 'aac',
					Protocol: 'hls',
					Context: 'Streaming',
					MaxAudioChannels: '2',
					MinSegments: 1,
					BreakOnNonKeyFrames: true
				}
			],
			CodecProfiles: [
				{
					Type: 'Video',
					Codec: 'h264',
					Conditions: [
						{ Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
						{
							Condition: 'NotEquals',
							Property: 'IsAnamorphic',
							Value: 'true',
							IsRequired: false
						}
					]
				}
			],
			SubtitleProfiles: [
				{ Format: 'vtt', Method: 'External' },
				{ Format: 'srt', Method: 'External' },
				{ Format: 'ass', Method: 'External' },
				{ Format: 'ssa', Method: 'External' }
			]
		};
	}

	/**
	 * Разрешает тайтл в готовый источник для плеера.
	 *
	 * Ключевой момент: audioStreamIndex влияет на то, какую дорожку Jellyfin вмуксит
	 * в манифест. Одна дорожка на манифест — поэтому смена озвучки вызывает этот
	 * метод заново с другим индексом.
	 */
	async getPlaybackSource(opts: {
		itemId: string;
		userId: string;
		audioStreamIndex?: number;
		subtitleStreamIndex?: number;
		maxBitrate?: number;
		startPositionSec?: number;
		/** Токен для медиа-URL: браузер отдаёт его как api_key, заголовки там не поставить. */
		mediaToken: string;
	}): Promise<PlaybackSource> {
		const maxBitrate = opts.maxBitrate ?? 40_000_000;

		const info = await this.request<{
			MediaSources: JfMediaSource[];
			PlaySessionId: string;
			ErrorCode?: string | null;
		}>(`/Items/${opts.itemId}/PlaybackInfo`, {
			method: 'POST',
			query: { userId: opts.userId },
			body: {
				UserId: opts.userId,
				MaxStreamingBitrate: maxBitrate,
				StartTimeTicks: 0,
				AudioStreamIndex: opts.audioStreamIndex,
				SubtitleStreamIndex: opts.subtitleStreamIndex ?? -1,
				MaxAudioChannels: 6,
				EnableDirectPlay: true,
				EnableDirectStream: true,
				EnableTranscoding: true,
				AllowVideoStreamCopy: true,
				AllowAudioStreamCopy: true,
				DeviceProfile: this.browserDeviceProfile(maxBitrate)
			}
		});

		if (info.ErrorCode) {
			throw new JellyfinError(409, `Jellyfin отказал в воспроизведении: ${info.ErrorCode}`);
		}

		const source = info.MediaSources?.[0];
		if (!source) throw new JellyfinError(404, 'Jellyfin не вернул ни одного медиаисточника');

		const streams = source.MediaStreams ?? [];
		const translations = buildTranslations(streams, source.DefaultAudioStreamIndex ?? null);

		const active =
			translations.find((t) => t.audioStreamIndex === opts.audioStreamIndex) ??
			translations.find((t) => t.isDefault) ??
			translations[0];

		// Позиция возобновления и сегменты — параллельно, они независимы.
		const [item, segments] = await Promise.all([
			this.getItem(opts.itemId, opts.userId).catch(() => null),
			this.getMediaSegments(opts.itemId).catch(() => [] as MediaSegment[])
		]);

		const playMethod: PlayMethod = source.SupportsDirectPlay
			? 'DirectPlay'
			: source.SupportsDirectStream && !source.TranscodingUrl
				? 'DirectStream'
				: 'Transcode';

		const streamUrl = this.buildStreamUrl(source, opts.itemId, opts.mediaToken, playMethod);

		return {
			jellyfinItemId: opts.itemId,
			mediaSourceId: source.Id,
			playSessionId: info.PlaySessionId,
			streamUrl,
			playMethod,
			durationSec: ticksToSeconds(source.RunTimeTicks ?? item?.RunTimeTicks ?? 0),
			startPositionSec:
				opts.startPositionSec ?? ticksToSeconds(item?.UserData?.PlaybackPositionTicks ?? 0),
			translations,
			activeTranslationId: active?.id ?? '',
			subtitles: buildSubtitles(streams, opts.itemId, source.Id, this.cfg.baseUrl, opts.mediaToken),
			trickplay: buildTrickplay(item, source.Id, this.cfg.baseUrl, opts.itemId, opts.mediaToken),
			segments
		};
	}

	/**
	 * URL потока.
	 *
	 * Для транскода берём TranscodingUrl из ответа, а не собираем master.m3u8 руками:
	 * в 10.11+ ручные HLS-роуты пропали из спеки, а TranscodingUrl это переживает.
	 */
	private buildStreamUrl(
		source: JfMediaSource,
		itemId: string,
		mediaToken: string,
		playMethod: PlayMethod
	): string {
		const base = this.cfg.baseUrl.replace(/\/+$/, '');

		if (source.TranscodingUrl) {
			const u = new URL(base + source.TranscodingUrl);
			if (!u.searchParams.has('api_key')) u.searchParams.set('api_key', mediaToken);
			return u.toString();
		}

		if (playMethod === 'DirectPlay' || playMethod === 'DirectStream') {
			const u = new URL(`${base}/Videos/${itemId}/stream`);
			u.searchParams.set('static', 'true');
			u.searchParams.set('mediaSourceId', source.Id);
			u.searchParams.set('api_key', mediaToken);
			return u.toString();
		}

		throw new JellyfinError(500, 'Jellyfin не дал ни TranscodingUrl, ни прямого потока');
	}

	/** Заставки и титры. На 10.10+ это ядро, плагин пишет данные сюда же. */
	async getMediaSegments(itemId: string): Promise<MediaSegment[]> {
		try {
			const r = await this.request<
				JfQueryResult<{ Type: string; StartTicks: number; EndTicks: number }>
			>(`/MediaSegments/${itemId}`, {
				query: { includeSegmentTypes: 'Intro,Outro' }
			});
			return (r.Items ?? []).map((s) => ({
				type: s.Type as MediaSegment['type'],
				startSec: ticksToSeconds(s.StartTicks),
				endSec: ticksToSeconds(s.EndTicks)
			}));
		} catch {
			// На 10.9 эндпоинта нет — не повод ронять воспроизведение.
			return [];
		}
	}

	/* --------------------------- отчёты о просмотре -------------------------- */

	async reportStart(p: {
		itemId: string;
		playSessionId: string;
		mediaSourceId: string;
		positionSec: number;
		audioStreamIndex?: number;
		playMethod: PlayMethod;
	}): Promise<void> {
		await this.request('/Sessions/Playing', {
			method: 'POST',
			body: {
				ItemId: p.itemId,
				PlaySessionId: p.playSessionId,
				MediaSourceId: p.mediaSourceId,
				PositionTicks: Math.round(p.positionSec * 10_000_000),
				AudioStreamIndex: p.audioStreamIndex,
				PlayMethod: p.playMethod,
				CanSeek: true,
				IsPaused: false
			}
		});
	}

	async reportProgress(p: {
		itemId: string;
		playSessionId: string;
		mediaSourceId: string;
		positionSec: number;
		isPaused: boolean;
		audioStreamIndex?: number;
		playMethod: PlayMethod;
	}): Promise<void> {
		await this.request('/Sessions/Playing/Progress', {
			method: 'POST',
			body: {
				ItemId: p.itemId,
				PlaySessionId: p.playSessionId,
				MediaSourceId: p.mediaSourceId,
				PositionTicks: Math.round(p.positionSec * 10_000_000),
				AudioStreamIndex: p.audioStreamIndex,
				PlayMethod: p.playMethod,
				IsPaused: p.isPaused,
				CanSeek: true
			}
		});
	}

	/** Именно этот вызов сохраняет позицию для «продолжить смотреть». */
	async reportStopped(p: {
		itemId: string;
		playSessionId: string;
		mediaSourceId: string;
		positionSec: number;
	}): Promise<void> {
		await this.request('/Sessions/Playing/Stopped', {
			method: 'POST',
			body: {
				ItemId: p.itemId,
				PlaySessionId: p.playSessionId,
				MediaSourceId: p.mediaSourceId,
				PositionTicks: Math.round(p.positionSec * 10_000_000),
				Failed: false
			}
		});
	}

	imageUrl(itemId: string, type: string, tag?: string, maxWidth?: number): string {
		const u = new URL(`${this.cfg.baseUrl.replace(/\/+$/, '')}/Items/${itemId}/Images/${type}`);
		if (tag) u.searchParams.set('tag', tag);
		if (maxWidth) u.searchParams.set('maxWidth', String(maxWidth));
		u.searchParams.set('quality', '90');
		return u.toString();
	}
}

/* ------------------------------- преобразования --------------------------- */

const LANG_RU: Record<string, string> = {
	rus: 'Русский',
	ru: 'Русский',
	eng: 'Английский',
	en: 'Английский',
	jpn: 'Японский',
	ja: 'Японский',
	ukr: 'Украинский',
	fra: 'Французский',
	fre: 'Французский',
	deu: 'Немецкий',
	ger: 'Немецкий',
	spa: 'Испанский',
	ita: 'Итальянский',
	kor: 'Корейский',
	zho: 'Китайский',
	chi: 'Китайский'
};

const localizeLang = (code?: string | null): string | undefined =>
	code ? (LANG_RU[code.toLowerCase()] ?? code.toUpperCase()) : undefined;

const CHANNEL_LABEL: Record<number, string> = { 1: 'Моно', 2: 'Стерео', 6: '5.1', 8: '7.1' };

/**
 * Собирает список озвучек из аудиопотоков.
 *
 * Подпись строим сами, а не берём DisplayTitle: у Jellyfin он на английском
 * и часто выглядит как «Russian - AC3 - 5.1 - Default», что в русском UI смотрится чужеродно.
 * Но если у дорожки есть осмысленный Title (студия озвучки), он важнее языка.
 */
export function buildTranslations(
	streams: JfMediaStream[],
	defaultIndex: number | null
): Translation[] {
	return streams
		.filter((s) => s.Type === 'Audio')
		.map((s) => {
			const lang = localizeLang(s.Language);
			const studio = s.Title?.trim();
			const codec = s.Codec?.toUpperCase();
			const channels = s.Channels ? (CHANNEL_LABEL[s.Channels] ?? `${s.Channels}.0`) : undefined;

			// Приоритет: студия -> язык -> запасной вариант
			const head = studio || lang || `Дорожка ${s.Index}`;
			const tail = [codec, channels].filter(Boolean).join(' · ');

			return {
				id: `a${s.Index}`,
				audioStreamIndex: s.Index,
				label: tail ? `${head} · ${tail}` : head,
				language: s.Language ?? undefined,
				codec: s.Codec ?? undefined,
				channels: s.Channels ?? undefined,
				isDefault: defaultIndex != null ? s.Index === defaultIndex : Boolean(s.IsDefault)
			};
		})
		.sort((a, b) => {
			// Русские дорожки наверх — это русскоязычный интерфейс.
			const ru = (t: Translation) => (t.language?.toLowerCase().startsWith('ru') ? 0 : 1);
			return ru(a) - ru(b) || Number(b.isDefault) - Number(a.isDefault);
		});
}

export function buildSubtitles(
	streams: JfMediaStream[],
	itemId: string,
	mediaSourceId: string,
	baseUrl: string,
	mediaToken: string
): SubtitleTrack[] {
	return streams
		.filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream !== false)
		.map((s) => {
			const lang = localizeLang(s.Language);
			const name = s.Title?.trim() || lang || `Дорожка ${s.Index}`;
			const marks = [s.IsForced ? 'форс.' : null, s.IsHearingImpaired ? 'SDH' : null].filter(
				Boolean
			);

			const url = new URL(
				`${baseUrl.replace(/\/+$/, '')}/Videos/${itemId}/${mediaSourceId}/Subtitles/${s.Index}/Stream.vtt`
			);
			url.searchParams.set('api_key', mediaToken);

			return {
				id: `s${s.Index}`,
				subtitleStreamIndex: s.Index,
				label: marks.length ? `${name} (${marks.join(', ')})` : name,
				language: s.Language ?? undefined,
				isForced: Boolean(s.IsForced),
				isHearingImpaired: Boolean(s.IsHearingImpaired),
				url: url.toString()
			};
		});
}

/**
 * Trickplay лежит вложенным словарём: mediaSourceId -> ширина -> описание.
 * Берём самую широкую доступную раскладку — она детальнее на таймлайне.
 */
export function buildTrickplay(
	item: JfItem | null,
	mediaSourceId: string,
	baseUrl: string,
	itemId: string,
	mediaToken: string
): TrickplayInfo | undefined {
	const bySource = item?.Trickplay?.[mediaSourceId];
	if (!bySource) return undefined;

	const widths = Object.keys(bySource)
		.map(Number)
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => b - a);
	if (!widths.length) return undefined;

	const info = bySource[String(widths[0])];
	if (!info) return undefined;

	const tpl = new URL(
		`${baseUrl.replace(/\/+$/, '')}/Videos/${itemId}/Trickplay/${info.Width}/{index}.jpg`
	);
	tpl.searchParams.set('mediaSourceId', mediaSourceId);
	tpl.searchParams.set('api_key', mediaToken);

	return {
		width: info.Width,
		height: info.Height,
		tileWidth: info.TileWidth,
		tileHeight: info.TileHeight,
		intervalMs: info.Interval,
		thumbnailCount: info.ThumbnailCount,
		// URL кодирует {index}, возвращаем обратно — на клиенте это шаблон.
		tileUrlTemplate: tpl.toString().replace('%7Bindex%7D', '{index}')
	};
}

export const getTmdbId = (item: JfItem): number | null => {
	const raw = item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb;
	const n = raw ? Number.parseInt(raw, 10) : NaN;
	return Number.isFinite(n) ? n : null;
};
