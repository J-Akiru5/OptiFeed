import { isTransportFailure } from "@/lib/offline/transport-error";
import { describe, expect, it } from "vitest";

/**
 * The biomass form only queues a sample when the failure was connectivity
 * (#751). Permission and validation errors must reach the farmer, not disappear
 * into an outbox that will replay the same rejected write.
 */
describe("isTransportFailure", () => {
	it("treats the browser being offline as a transport failure", () => {
		expect(isTransportFailure(new Error("Forbidden"), false)).toBe(true);
	});

	it("recognises fetch and network TypeErrors", () => {
		expect(isTransportFailure(new TypeError("Failed to fetch"), true)).toBe(true);
		expect(isTransportFailure(new TypeError("fetch failed"), true)).toBe(true);
		expect(isTransportFailure(new TypeError("Load failed"), true)).toBe(true);
	});

	it("recognises network errors thrown by other clients", () => {
		expect(
			isTransportFailure(new Error("NetworkError when attempting to fetch resource."), true),
		).toBe(true);
		expect(isTransportFailure(new Error("ERR_INTERNET_DISCONNECTED"), true)).toBe(true);
	});

	it("does not queue permission, session or validation errors", () => {
		expect(isTransportFailure(new Error("Forbidden"), true)).toBe(false);
		expect(isTransportFailure(new Error("Unauthorized"), true)).toBe(false);
		expect(isTransportFailure(new Error("NEXT_REDIRECT"), true)).toBe(false);
		expect(isTransportFailure(new Error("Sample weight must be greater than 0"), true)).toBe(false);
	});

	it("defaults an unknown throw to a visible error, never a queued write", () => {
		expect(isTransportFailure(undefined, true)).toBe(false);
		expect(isTransportFailure({}, true)).toBe(false);
	});
});
