import { shouldQueueOffline } from "@/lib/offline/classify";
import { describe, expect, it } from "vitest";

/**
 * #751 — the biomass form queued any thrown save into the offline outbox, so a
 * validation or database failure was reported as "saved offline" and replayed
 * forever. Only failures where the request never reached the server qualify.
 */
describe("shouldQueueOffline", () => {
	it("queues when the browser reports no connection", () => {
		expect(shouldQueueOffline(new Error("anything"), false)).toBe(true);
	});

	it("queues fetch's network TypeError", () => {
		expect(shouldQueueOffline(new TypeError("Failed to fetch"), true)).toBe(true);
		expect(shouldQueueOffline(new Error("NetworkError when attempting to fetch"), true)).toBe(true);
	});

	it("does not queue application errors that reached the server", () => {
		expect(shouldQueueOffline(new Error("Only the pond owner can change this"), true)).toBe(false);
		expect(shouldQueueOffline({ digest: "12345" }, true)).toBe(false);
	});

	it("does not queue a deliberate abort or timeout, even while offline", () => {
		expect(shouldQueueOffline(new DOMException("Aborted", "AbortError"), true)).toBe(false);
		expect(shouldQueueOffline(new DOMException("Timeout", "TimeoutError"), true)).toBe(false);
		expect(shouldQueueOffline(new DOMException("Aborted", "AbortError"), false)).toBe(false);
	});
});
