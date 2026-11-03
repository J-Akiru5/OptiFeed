import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { deviceStateEvent: { findFirst: vi.fn() } },
}));

import {
	HEALTHY_VIEW,
	getDeviceHealthSafe,
	resetDeviceHealthCacheForTests,
} from "@/lib/device-health";
import prisma from "@/lib/prisma";

/**
 * Pages about something else (dashboard, schedule) show device health as an
 * extra. A failed read must not take them down, and must not report the feeder
 * as healthy (#624).
 */

beforeEach(() => {
	resetDeviceHealthCacheForTests();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("getDeviceHealthSafe", () => {
	it("returns the device's stored state when the read works", async () => {
		vi.mocked(prisma.deviceStateEvent.findFirst).mockImplementation((async (args: {
			where: { eventType: string };
		}) =>
			args.where.eventType === "device_health"
				? {
						createdAt: new Date("2026-11-01T00:00:00Z"),
						metadata: {
							safeMode: true,
							faultsPresent: 0,
							faultsLatched: 0,
						},
					}
				: null) as never);

		const view = await getDeviceHealthSafe("dev-1", new Date("2026-11-01T01:00:00Z"));

		expect(view.safeMode).toBe(true);
	});

	it("returns an explicit cannot-verify view when the database read fails", async () => {
		vi.mocked(prisma.deviceStateEvent.findFirst).mockRejectedValue(new Error("db down"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const now = new Date("2026-11-01T01:00:00Z");

		const view = await getDeviceHealthSafe("dev-1", now);

		expect(view.unavailable).toEqual({ checkedAt: now, lastSuccessAt: null });
		expect(view).not.toEqual(HEALTHY_VIEW);
		expect(warn).toHaveBeenCalledWith("[device-health] read failed", "db down");
		warn.mockRestore();
	});

	it("remembers the last successful read for the unknown-since line", async () => {
		vi.mocked(prisma.deviceStateEvent.findFirst).mockImplementation((async (args: {
			where: { eventType: string };
		}) =>
			args.where.eventType === "device_health"
				? {
						createdAt: new Date("2026-11-01T00:00:00Z"),
						metadata: { safeMode: false, faultsPresent: 0, faultsLatched: 0 },
					}
				: null) as never);
		const first = new Date("2026-11-01T01:00:00Z");
		await getDeviceHealthSafe("dev-2", first);

		vi.mocked(prisma.deviceStateEvent.findFirst).mockRejectedValue(new Error("db down"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const second = new Date("2026-11-01T01:05:00Z");
		const view = await getDeviceHealthSafe("dev-2", second);

		expect(view.unavailable).toEqual({ checkedAt: second, lastSuccessAt: first });
		warn.mockRestore();
	});
});
