import type { SessionUser, Theme } from '$lib/types';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			theme: Theme;
			demoMode: boolean;
			libraryConnected: boolean;
		}
		interface PageData {
			user?: SessionUser | null;
			theme?: Theme;
			demoMode?: boolean;
			libraryConnected?: boolean;
		}
	}
}

export {};
