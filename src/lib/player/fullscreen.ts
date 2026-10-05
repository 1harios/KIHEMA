/** Fullscreen the entire viewing room, never the native video-only player. */
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type WebkitDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => void | Promise<void>;
};

export function fullscreenElement(doc: Document = document): Element | null {
	return doc.fullscreenElement ?? (doc as WebkitDocument).webkitFullscreenElement ?? null;
}

/** False means the caller should use its in-page, chat-capable fullscreen. */
export async function enterFullscreen(root: HTMLElement): Promise<boolean> {
	try {
		if (root.requestFullscreen) {
			try { await root.requestFullscreen({ navigationUI: 'hide' }); }
			catch (error) {
				// Older implementations reject the options object, not fullscreen itself.
				if (!(error instanceof Error) || !['TypeError', 'NotSupportedError'].includes(error.name)) throw error;
				await root.requestFullscreen();
			}
		}
		else if ((root as WebkitElement).webkitRequestFullscreen) {
			await (root as WebkitElement).webkitRequestFullscreen!();
		} else return false;
		return fullscreenElement() === root;
	} catch {
		return false;
	}
}

/** iPhone browsers cannot all fullscreen a DOM room (video + chat). */
export function fullscreenHint(): string | null {
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
	return ios && !standalone ? 'Для просмотра с чатом без адресной строки на iPhone: «Поделиться» → «На экран Домой». Включите «Открывать как веб-приложение», если такой пункт есть, и запускайте КИХЕМА с новой иконки. Если в Chrome нет этого пункта, добавьте сайт через Safari.' : null;
}

export async function exitFullscreen(): Promise<void> {
	if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
	else await (document as WebkitDocument).webkitExitFullscreen?.();
}
