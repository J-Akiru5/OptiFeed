export const FEED_COMMAND_OFFLINE_CODE = "feed_command_offline";

export type FeedCommandGuard =
	| { allowed: true }
	| { allowed: false; code: typeof FEED_COMMAND_OFFLINE_CODE };

/**
 * Feeder controls (manual feed, pause, resume) must be confirmed online and
 * sent immediately. They are never queued, so an offline browser blocks them.
 */
export function isBrowserOnline(): boolean {
	if (typeof navigator === "undefined") return true;
	return navigator.onLine !== false;
}

export function guardFeedCommand(online: boolean = isBrowserOnline()): FeedCommandGuard {
	return online ? { allowed: true } : { allowed: false, code: FEED_COMMAND_OFFLINE_CODE };
}

export class FeedCommandOfflineError extends Error {
	readonly code = FEED_COMMAND_OFFLINE_CODE;

	constructor() {
		super("Feeder controls need an internet connection. Reconnect and try again.");
		this.name = "FeedCommandOfflineError";
	}
}

export function assertFeedCommandOnline(online: boolean = isBrowserOnline()): void {
	if (!guardFeedCommand(online).allowed) throw new FeedCommandOfflineError();
}
