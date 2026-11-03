import { describe, expect, it } from "vitest";

import type { FeederDeviceDetail } from "@/lib/feeder/detail";
import { toStatePayload } from "@/lib/feeder/state-payload";

/**
 * The poll DTO (#620) must carry the same health fields the server render
 * shows, or the viewer freezes them. This is the projection under test.
 */

const DETAIL: FeederDeviceDetail = {
	id: "dev-1",
	label: "CICT Feeder",
	mac: "68:09:47:25:E1:80",
	lastSeenAt: new Date("2026-11-03T07:59:00.000Z"),
	rtcOk: true,
	waterTempOk: false,
	waterTempC: 27.1,
	waterTempUpdatedAt: new Date("2026-11-03T07:58:00.000Z"),
	staleAfterMs: 300_000,
	diag: { version: "1.6.0" },
	firmwareVersion: "1.6.0",
	signalDbm: -62,
	isPaused: false,
	feedLevelPercent: 62,
	feedLevelUpdatedAt: new Date("2026-11-03T07:57:00.000Z"),
	hopperCapacityG: 25_000,
	gramsPerFeeding: 330,
	pond: { id: "pond-1", name: "Pond 1" },
	lastFedAt: new Date("2026-11-03T06:00:00.000Z"),
	lastFedGrams: 120,
	status: "idle",
};

describe("toStatePayload", () => {
	it("carries the water probe and RTC health the viewer needs", () => {
		const payload = toStatePayload(DETAIL);

		expect(payload.waterTempOk).toBe(false);
		expect(payload.waterTempC).toBe(27.1);
		expect(payload.rtcOk).toBe(true);
		expect(payload.staleAfterMs).toBe(300_000);
	});

	it("carries the signal, firmware and hopper timestamp for the large screen (#616)", () => {
		const payload = toStatePayload(DETAIL);

		expect(payload.signalDbm).toBe(-62);
		expect(payload.firmwareVersion).toBe("1.6.0");
		expect(payload.feedLevelUpdatedAt).toBe("2026-11-03T07:57:00.000Z");
	});

	it("serialises dates as ISO strings and keeps missing readings null", () => {
		const payload = toStatePayload({
			...DETAIL,
			lastSeenAt: null,
			lastFedAt: null,
			waterTempUpdatedAt: null,
			waterTempC: null,
		});

		expect(payload.lastSeenAt).toBeNull();
		expect(payload.lastFedAt).toBeNull();
		expect(payload.waterTempUpdatedAt).toBeNull();
		expect(payload.waterTempC).toBeNull();
		expect(payload.lastFedGrams).toBe(120);
	});

	it("keeps the fields the poll already carried", () => {
		const payload = toStatePayload(DETAIL);

		expect(payload.deviceId).toBe("dev-1");
		expect(payload.status).toBe("idle");
		expect(payload.feedLevelPercent).toBe(62);
		expect(payload.waterTempUpdatedAt).toBe("2026-11-03T07:58:00.000Z");
	});
});
