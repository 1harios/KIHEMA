/** Pure helpers shared by invitations and the playback synchronizer. */
export function roomCodeFrom(input: string): string | null {
	const text = input.trim();
	if (/^[A-Z2-9]{6}$/i.test(text)) return text.toUpperCase();
	try {
		const url = new URL(text, 'https://kihema.vercel.app');
		const code = url.searchParams.get('room') ?? url.pathname.match(/^\/party\/([A-Z2-9]{6})\/?$/i)?.[1];
		return code && /^[A-Z2-9]{6}$/i.test(code) ? code.toUpperCase() : null;
	} catch {
		return null;
	}
}

/** Never navigate to a foreign URL or carry a guest's personal resume time. */
export function watchHref(input: string): string | null {
	if (!input.startsWith('/') || input.startsWith('//')) return null;
	try {
		const url = new URL(input, 'https://kihema.vercel.app');
		if (!/^\/(movie|show)\/[^/]+\/watch$/.test(url.pathname)) return null;
		const params = new URLSearchParams();
		for (const key of ['season', 'episode', 's', 'e']) {
			const value = url.searchParams.get(key);
			if (value && /^\d+$/.test(value)) params.set(key, value);
		}
		params.sort();
		return url.pathname + (params.size ? `?${params}` : '');
	} catch {
		return null;
	}
}

export function roomPosition(
	state: { paused: boolean; positionSec: number; anchorTs: number; rate?: number; buffering?: boolean },
	serverNow: number
): number {
	const elapsed = state.paused || state.buffering ? 0 : Math.max(0, serverNow - state.anchorTs) / 1000;
	return Math.max(0, state.positionSec + elapsed * (state.rate ?? 1));
}

export function syncRate(baseRate: number, drift: number): number {
	return baseRate * (Math.abs(drift) < 0.25 ? 1 : drift > 0 ? 1.035 : 0.965);
}
