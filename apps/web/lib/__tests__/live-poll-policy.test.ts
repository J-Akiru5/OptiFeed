import { describe, expect, it } from "vitest";

import { LIVE_POLL_MS, livePollDelayMs, livePollTier } from "@/lib/live/poll-policy";

/**
 * #731: the cadence is decided in one place. These assertions are the contract
 * — a caller must not be able to reintroduce a fixed interval without failing
 * here.
 */
describe("live poll policy", () => {
	it("polls at the heartbeat cadence only while a feed is in flight", () => {
		expect(livePollTier({ visible: true, feedPending: true })).toBe("fast");
		expect(livePollDelayMs({ visible: true, feedPending: true })).toBe(LIVE_POLL_MS.fast);
	});

	it("backs off when the tab is visible and nothing is waiting", () => {
		expect(livePollTier({ visible: true, feedPending: false })).toBe("idle");
		expect(livePollDelayMs({ visible: true, feedPending: false })).toBe(LIVE_POLL_MS.idle);
	});

	it("stops entirely while the tab is hidden, pending feed or not", () => {
		expect(livePollTier({ visible: false, feedPending: true })).toBe("hidden");
		expect(livePollTier({ visible: false, feedPending: false })).toBe("hidden");
		expect(livePollDelayMs({ visible: false, feedPending: true })).toBeNull();
		expect(livePollDelayMs({ visible: false, feedPending: false })).toBeNull();
	});

	it("never polls faster than the device can produce a new reading", () => {
		// The firmware polls the server every 5 s, so a shorter interval re-reads
		// the same row. Changing this without changing the firmware cadence fails.
		expect(LIVE_POLL_MS.fast).toBe(5_000);
		expect(LIVE_POLL_MS.idle).toBe(30_000);
		expect(LIVE_POLL_MS.idle).toBeGreaterThan(LIVE_POLL_MS.fast);
	});
});
