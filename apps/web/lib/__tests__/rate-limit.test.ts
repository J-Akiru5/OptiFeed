import { beforeEach, describe, expect, it } from "vitest";
import { checkApiRateLimit, checkDeviceRateLimit, checkLoginRateLimit } from "../rate-limit";

describe("checkLoginRateLimit", () => {
	beforeEach(() => {
		// Clear internal state by doing many resets
		for (let i = 0; i < 10; i++) {
			checkLoginRateLimit(`reset-${i}-${Date.now()}`);
		}
	});

	it("allows first request", () => {
		const result = checkLoginRateLimit("test-ip-1");
		expect(result.success).toBe(true);
		expect(result.remaining).toBe(4);
	});

	it("allows up to 5 requests", () => {
		for (let i = 0; i < 5; i++) {
			const result = checkLoginRateLimit("test-ip-2");
			expect(result.success).toBe(true);
		}
	});

	it("blocks 6th request", () => {
		for (let i = 0; i < 6; i++) {
			checkLoginRateLimit("test-ip-3");
		}
		const result = checkLoginRateLimit("test-ip-3");
		expect(result.success).toBe(false);
	});
});

describe("checkApiRateLimit", () => {
	it("allows first request", () => {
		const result = checkApiRateLimit("user-1");
		expect(result.success).toBe(true);
	});
});

describe("checkDeviceRateLimit", () => {
	it("allows first request", () => {
		const result = checkDeviceRateLimit("esp32-device-1");
		expect(result.success).toBe(true);
		expect(result.remaining).toBe(19);
	});

	it("tracks per-device independently", () => {
		const r1 = checkDeviceRateLimit("device-a");
		const r2 = checkDeviceRateLimit("device-b");
		expect(r1.success).toBe(true);
		expect(r2.success).toBe(true);
	});
});
