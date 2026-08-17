/**
 * Сессия пользователя.
 *
 * Токен Jellyfin никогда не попадает в браузер: он лежит в подписанной httpOnly
 * cookie, а все обращения к Jellyfin идут через наши серверные роуты.
 *
 * Исключение — медиа-URL (HLS-сегменты, субтитры, тайлы Trickplay). Там заголовок
 * не поставить, поэтому токен уходит в query как api_key. Чтобы не светить
 * пользовательский токен, для медиа выдаём отдельный короткоживущий токен —
 * см. mediaToken ниже.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { config } from './config';

const COOKIE = 'ls_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

export interface SessionData {
	jellyfinToken: string;
	userId: string;
	userName: string;
	isAdmin: boolean;
	/** Стабильный на устройство: Jellyfin ведёт по нему список сессий. */
	deviceId: string;
}

const b64url = (buf: Buffer | string): string =>
	Buffer.from(buf).toString('base64url');

const sign = (payload: string): string =>
	createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function encodeSession(data: SessionData): string {
	const payload = b64url(JSON.stringify(data));
	return `${payload}.${sign(payload)}`;
}

export function decodeSession(raw: string | undefined): SessionData | null {
	if (!raw) return null;

	const dot = raw.lastIndexOf('.');
	if (dot < 1) return null;

	const payload = raw.slice(0, dot);
	const provided = raw.slice(dot + 1);
	const expected = sign(payload);

	// Сравнение постоянного времени: иначе подпись подбирается побайтово.
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	try {
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionData;
	} catch {
		return null;
	}
}

export function setSessionCookie(cookies: Cookies, data: SessionData): void {
	cookies.set(COOKIE, encodeSession(data), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		maxAge: MAX_AGE
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: '/' });
}

export function readSession(cookies: Cookies): SessionData | null {
	return decodeSession(cookies.get(COOKIE));
}

export const newDeviceId = (): string => randomUUID();

export const SESSION_COOKIE = COOKIE;
