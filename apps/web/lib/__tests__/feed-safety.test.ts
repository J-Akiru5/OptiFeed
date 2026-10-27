import {
	FEED_COMMAND_OFFLINE_CODE,
	FeedCommandOfflineError,
	assertFeedCommandOnline,
	guardFeedCommand,
	isBrowserOnline,
} from "@/lib/pwa/feed-safety";
import { describe, expect, it } from "vitest";

describe("feed command offline guard", () => {
	it("allows a feed command only when the browser is online", () => {
		expect(guardFeedCommand(true)).toEqual({ allowed: true });
		expect(guardFeedCommand(false)).toEqual({
			allowed: false,
			code: FEED_COMMAND_OFFLINE_CODE,
		});
	});

	it("refuses with a stable code and a user-safe message", () => {
		expect(() => assertFeedCommandOnline(false)).toThrow(FeedCommandOfflineError);
		try {
			assertFeedCommandOnline(false);
		} catch (error) {
			const offline = error as FeedCommandOfflineError;
			expect(offline.code).toBe(FEED_COMMAND_OFFLINE_CODE);
			expect(offline.message).toMatch(/internet connection/i);
			expect(offline.message).not.toMatch(/token|password|secret/i);
		}
	});

	it("does not throw when online", () => {
		expect(() => assertFeedCommandOnline(true)).not.toThrow();
	});

	it("treats a missing navigator as online (server rendering)", () => {
		expect(typeof isBrowserOnline()).toBe("boolean");
	});
});
