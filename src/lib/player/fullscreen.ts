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
		if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
		else if ((root as WebkitElement).webkitRequestFullscreen) {
			await (root as WebkitElement).webkitRequestFullscreen!();
		} else return false;
		return fullscreenElement() === root;
	} catch {
		return false;
	}
}

export async function exitFullscreen(): Promise<void> {
	if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
	else await (document as WebkitDocument).webkitExitFullscreen?.();
}
