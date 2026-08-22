/**
 * Совместный просмотр — клиентская сторона.
 *
 * Модульный синглтон (паттерн progress.svelte.ts): WebSocket должен переживать
 * SPA-переходы между сериями, когда хост ведёт комнату на следующую серию —
 * goto() внутри приложения модули не перезагружает.
 *
 * Синхронизация времени: у комнаты есть авторитетное состояние
 * {позиция, пауза, момент фиксации}. Текущая общая позиция считается как
 * positionSec + (now − anchorTs), поэтому клиентам достаточно изредка
 * сверять часы с сервером (ping/pong), а не гонять время каждую секунду.
 */

export type PartyStatus = 'idle' | 'connecting' | 'in-room' | 'reconnecting' | 'error';

export interface PartyPeer {
	id: string;
	name: string;
	buffering: boolean;
}

export interface ChatMessage {
	id: string;
	name: string;
	text: string;
	ts: number;
	self: boolean;
}

export interface Reaction {
	id: string;
	name: string;
	emoji: string;
}

export interface PartyToast {
	id: number;
	text: string;
}

export interface RoomState {
	targetHref: string;
	paused: boolean;
	positionSec: number;
	anchorTs: number;
	translationLabel: string | null;
}

/** Снимок текущего воспроизведения — отправляется при создании комнаты. */
export interface RoomSnapshot {
	targetHref: string;
	positionSec: number;
	paused: boolean;
	translationLabel: string | null;
}

const NAME_KEY = 'kinema:party:name';
const MAX_CHAT_LOG = 100;
const MAX_RECONNECT_DELAY_MS = 30_000;

export const party = $state({
	status: 'idle' as PartyStatus,
	roomCode: null as string | null,
	selfId: '',
	selfName: '',
	hostId: '',
	peers: [] as PartyPeer[],
	roomState: null as RoomState | null,
	/** Кто последним изменил состояние — своим действиям не применяем повторно. */
	stateBy: null as string | null,
	translationBy: null as string | null,
	chatLog: [] as ChatMessage[],
	chatOpen: false,
	unread: 0,
	reactions: [] as Reaction[],
	toasts: [] as PartyToast[],
	/** Локальное время (мс) окончания отсчёта 3-2-1; 0 — отсчёта нет. */
	countdownUntil: 0,
	kicked: false,
	error: null as string | null
});

/** Функции вместо $derived: Svelte не даёт экспортировать derived из модуля. */
export const isHost = () => party.selfId !== '' && party.selfId === party.hostId;
export const inParty = () => party.status === 'in-room' || party.status === 'reconnecting';

/* ------------------------------ служебное -------------------------------- */

let ws: WebSocket | null = null;
let clockOffset = 0;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
let connectResolve: ((code: string) => void) | null = null;
let connectReject: ((err: Error) => void) | null = null;
let pingSamples: number[] = [];
let toastSeq = 0;

/**
 * Подавление эха. Видео-события (pause/seeked) приходят асинхронно после
 * программного вызова, поэтому флаг «применяю удалённое» ненадёжен. Вместо
 * него: применяя чужую команду, запоминаем её сигнатуру; если вскоре видео
 * сообщает ровно её — это эхо нашей же применённой команды, слать не надо.
 */
let lastRemote: { paused: boolean; pos: number; at: number } | null = null;

export function applyRemote(paused: boolean, pos: number, fn: () => void): void {
	lastRemote = { paused, pos, at: Date.now() };
	fn();
}

export function isEcho(paused: boolean, pos: number): boolean {
	if (!lastRemote) return false;
	if (Date.now() - lastRemote.at > 1500) return false;
	return paused === lastRemote.paused && Math.abs(pos - lastRemote.pos) < 0.7;
}

export function pushToast(text: string): void {
	const t: PartyToast = { id: ++toastSeq, text };
	party.toasts = [...party.toasts, t];
	setTimeout(() => {
		party.toasts = party.toasts.filter((x) => x.id !== t.id);
	}, 3500);
}

export function savedName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
}

function rememberName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		/* приватный режим — не критично */
	}
}

/** ?room=CODE в адресе — по нему страница возвращается в комнату после F5. */
function setRoomParam(code: string | null): void {
	if (typeof history === 'undefined' || typeof location === 'undefined') return;
	const u = new URL(location.href);
	if (code) u.searchParams.set('room', code);
	else u.searchParams.delete('room');
	history.replaceState(history.state, '', u);
}

/** Дописывает ?room=CODE к внутренним переходам (следующая серия и т.п.). */
export function withPartyParams(href: string): string {
	if (!party.roomCode) return href;
	try {
		const u = new URL(href, typeof location !== 'undefined' ? location.origin : undefined);
		u.searchParams.set('room', party.roomCode);
		return u.pathname + u.search;
	} catch {
		return href;
	}
}

/** Где комната находится сейчас, с учётом хода времени. */
export function sharedPosition(): number {
	const st = party.roomState;
	if (!st) return 0;
	if (st.paused) return st.positionSec;
	return st.positionSec + (Date.now() + clockOffset - st.anchorTs) / 1000;
}

function reset(): void {
	if (retryTimer) clearTimeout(retryTimer);
	if (connectTimer) clearTimeout(connectTimer);
	if (countdownTimer) clearTimeout(countdownTimer);
	retryTimer = connectTimer = countdownTimer = null;
	party.status = 'idle';
	party.roomCode = null;
	party.selfId = '';
	party.selfName = '';
	party.hostId = '';
	party.peers = [];
	party.roomState = null;
	party.stateBy = null;
	party.translationBy = null;
	party.chatLog = [];
	party.unread = 0;
	party.reactions = [];
	party.countdownUntil = 0;
	party.error = null;
	lastRemote = null;
}

/* ------------------------------ подключение ------------------------------ */

async function discoverUrl(): Promise<string | null> {
	try {
		const res = await fetch('/api/party/url', { cache: 'no-store' });
		if (!res.ok) return null;
		const data = (await res.json()) as { url?: string };
		return data.url ?? null;
	} catch {
		return null;
	}
}

function openSocket(url: string, hello: Record<string, unknown>): void {
	intentionalClose = false;
	const sock = new WebSocket(url.replace(/^http/, 'ws'));
	ws = sock;
	sock.onopen = () => sock.send(JSON.stringify(hello));
	sock.onmessage = (e) => {
		try {
			handleMessage(JSON.parse(String(e.data)));
		} catch {
			/* повреждённое сообщение — пропускаем */
		}
	};
	sock.onclose = () => {
		if (sock !== ws) return; // сокет уже заменён новым
		handleClose();
	};
	sock.onerror = () => sock.close();
}

async function connect(
	action: 'create' | 'join',
	code: string | null,
	name: string,
	snap: RoomSnapshot | null
): Promise<string> {
	if (party.status === 'connecting') throw new Error('Уже подключаемся');

	party.status = 'connecting';
	party.error = null;

	const url = await discoverUrl();
	if (!url) {
		party.status = 'error';
		party.error = 'Сервер комнат недоступен';
		throw new Error('Сервер комнат недоступен');
	}

	openSocket(url, {
		type: 'hello',
		action,
		room: code ?? undefined,
		name,
		targetHref: snap?.targetHref,
		positionSec: snap?.positionSec,
		paused: snap?.paused,
		translationLabel: snap?.translationLabel
	});

	return new Promise<string>((resolve, reject) => {
		connectResolve = resolve;
		connectReject = reject;
		connectTimer = setTimeout(() => {
			connectResolve = connectReject = null;
			intentionalClose = true;
			ws?.close();
			ws = null;
			if (party.status === 'connecting') {
				party.status = 'error';
				party.error = 'Сервер комнат не ответил';
			}
			reject(new Error('Сервер комнат не ответил'));
		}, 12_000);
	});
}

/** Создать комнату. Возвращает её код. */
export async function create(name: string, snap: RoomSnapshot): Promise<string> {
	const code = await connect('create', null, name, snap);
	rememberName(name);
	return code;
}

/** Войти в комнату по коду. */
export async function join(code: string, name: string, snap: RoomSnapshot | null): Promise<void> {
	await connect('join', code.toUpperCase(), name, snap);
	rememberName(name);
}

/** Покинуть комнату (или закрыть её, если ты последний). */
export function leave(): void {
	intentionalClose = true;
	const sock = ws;
	ws = null;
	sock?.close();
	reset();
	setRoomParam(null);
}

/* ------------------------------- пересборка -------------------------------- */

function handleClose(): void {
	if (intentionalClose) return;
	const wasConnecting = connectReject != null;

	// Не было welcome — проваливаем рукопожатие.
	if (wasConnecting) {
		const reject = connectReject;
		connectResolve = connectReject = null;
		if (connectTimer) clearTimeout(connectTimer);
		connectTimer = null;
		party.status = 'error';
		party.error = 'Соединение с сервером комнат оборвалось';
		reject?.(new Error('Соединение оборвалось'));
		return;
	}

	if (party.status !== 'in-room') return;
	party.status = 'reconnecting';
	scheduleReconnect();
}

function scheduleReconnect(): void {
	const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** retryCount);
	retryCount += 1;
	retryTimer = setTimeout(() => void reconnect(), delay);
}

/**
 * Переподключение. Каждый раз заново узнаём адрес: quick-туннель при рестарте
 * VPS получает новый URL, и старый сокет больше не оживёт.
 */
async function reconnect(): Promise<void> {
	const code = party.roomCode;
	const name = party.selfName;
	if (!code || !name || party.status !== 'reconnecting') return;

	const url = await discoverUrl();
	if (!url) {
		scheduleReconnect();
		return;
	}

	openSocket(url, { type: 'hello', action: 'join', room: code, name });
	// Дальше либо welcome (handleMessage снимет reconnecting), либо ошибка.
}

/* ------------------------------ обработка WS ----------------------------- */

function handleMessage(m: Record<string, unknown>): void {
	switch (m.type) {
		case 'welcome': {
			if (connectTimer) clearTimeout(connectTimer);
			connectTimer = null;
			party.kicked = false;
			party.roomCode = String(m.room);
			party.selfId = String((m.self as { id: string }).id);
			party.selfName = String((m.self as { name: string }).name);
			party.hostId = String(m.hostId);
			party.peers = m.peers as PartyPeer[];
			party.roomState = m.state as RoomState;
			// При входе применяем состояние комнаты (позицию выровняет плеер).
			party.stateBy = 'server';
			party.translationBy = 'server';
			party.status = 'in-room';
			party.error = null;
			retryCount = 0;
			clockOffset = Number(m.serverTs) - Date.now();
			setRoomParam(party.roomCode);
			startClockSync();
			const resolve = connectResolve;
			connectResolve = connectReject = null;
			resolve?.(party.roomCode ?? '');
			break;
		}

		case 'error': {
			const code = String(m.code);
			const message = String(m.message ?? 'ошибка сервера комнат');
			if (party.status === 'reconnecting') {
				// Сервер комнат перезапущен — комнат больше нет.
				intentionalClose = true;
				ws = null;
				reset();
				setRoomParam(null);
				pushToast(code === 'room_not_found' ? 'Комната исчезла — продолжаем в одиночку' : message);
				return;
			}
			const reject = connectReject;
			connectResolve = connectReject = null;
			if (connectTimer) clearTimeout(connectTimer);
			connectTimer = null;
			intentionalClose = true;
			ws?.close();
			ws = null;
			party.status = 'error';
			party.error = code === 'room_not_found' ? 'Комната не найдена' : message;
			reject?.(new Error(party.error));
			break;
		}

		case 'presence': {
			party.hostId = String(m.hostId ?? '');
			party.peers = m.peers as PartyPeer[];
			break;
		}

		case 'state': {
			const { by, ...rest } = m as unknown as { by?: string } & RoomState;
			party.roomState = {
				targetHref: rest.targetHref,
				paused: rest.paused,
				positionSec: rest.positionSec,
				anchorTs: rest.anchorTs,
				translationLabel: rest.translationLabel ?? null
			};
			party.stateBy = by ?? null;
			break;
		}

		case 'goto': {
			const st = party.roomState;
			party.roomState = {
				targetHref: String(m.targetHref),
				paused: true,
				positionSec: 0,
				anchorTs: Date.now() + clockOffset,
				translationLabel: st?.translationLabel ?? null
			};
			party.stateBy = String(m.by ?? '');
			break;
		}

		case 'translation': {
			const st = party.roomState;
			if (st) party.roomState = { ...st, translationLabel: String(m.label) };
			party.translationBy = String(m.by ?? '');
			break;
		}

		case 'chat': {
			const msg: ChatMessage = {
				id: String(m.id),
				name: String(m.name),
				text: String(m.text),
				ts: Number(m.ts),
				self: String(m.peerId) === party.selfId
			};
			party.chatLog = [...party.chatLog.slice(-(MAX_CHAT_LOG - 1)), msg];
			if (!party.chatOpen && !msg.self) party.unread += 1;
			break;
		}

		case 'react': {
			const r: Reaction = { id: String(m.id), name: String(m.name), emoji: String(m.emoji) };
			party.reactions = [...party.reactions, r];
			setTimeout(() => {
				party.reactions = party.reactions.filter((x) => x.id !== r.id);
			}, 2200);
			break;
		}

		case 'countdown': {
			const until = Number(m.startTs) + clockOffset;
			party.countdownUntil = until;
			if (countdownTimer) clearTimeout(countdownTimer);
			countdownTimer = setTimeout(() => (party.countdownUntil = 0), Math.max(0, until - Date.now()) + 600);
			break;
		}

		case 'kick': {
			intentionalClose = true;
			ws?.close();
			ws = null;
			reset();
			setRoomParam(null);
			party.kicked = true;
			break;
		}

		case 'pong': {
			const t = Number(m.t);
			const rtt = Date.now() - t;
			if (rtt >= 0) pingSamples.push(Number(m.serverTs) + rtt / 2 - Date.now());
			if (pingSamples.length === 3) {
				pingSamples.sort((a, b) => a - b);
				clockOffset = pingSamples[1];
				pingSamples = [];
			}
			break;
		}
	}
}

function startClockSync(): void {
	pingSamples = [];
	for (let i = 0; i < 3; i++) {
		setTimeout(() => send({ type: 'ping', t: Date.now() }), 300 + i * 400);
	}
}

/* -------------------------------- отправка -------------------------------- */

function send(msg: Record<string, unknown>): void {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Пауза/пуск от любого участника. */
export function sendState(paused: boolean, positionSec: number): void {
	if (party.status !== 'in-room') return;
	if (isEcho(paused, positionSec)) return;
	send({ type: 'state', paused, positionSec });
}

export function sendSeek(positionSec: number): void {
	if (party.status !== 'in-room') return;
	if (isEcho(party.roomState?.paused ?? false, positionSec)) return;
	send({ type: 'seek', positionSec });
}

/** Смена фильма/серии — право хоста. */
export function sendGoto(targetHref: string): void {
	if (party.status !== 'in-room' || !isHost()) return;
	send({ type: 'goto', targetHref });
}

/** Смена озвучки — право хоста. */
export function sendTranslation(label: string): void {
	if (party.status !== 'in-room' || !isHost()) return;
	send({ type: 'translation', label });
}

export function sendChat(text: string): void {
	if (party.status !== 'in-room') return;
	send({ type: 'chat', text });
}

export function sendReact(emoji: string): void {
	if (party.status !== 'in-room') return;
	send({ type: 'react', emoji });
}

export function sendBuffering(buffering: boolean): void {
	if (party.status !== 'in-room') return;
	send({ type: 'buffering', buffering });
}

export function kick(peerId: string): void {
	if (party.status !== 'in-room' || !isHost()) return;
	send({ type: 'kick', peerId });
}

export function startCountdown(): void {
	if (party.status !== 'in-room' || !isHost()) return;
	send({ type: 'countdown' });
}

export function markChatRead(): void {
	party.unread = 0;
}
