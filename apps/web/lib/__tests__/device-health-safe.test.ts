import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { deviceStateEvent: { findFirst: vi.fn() } },
}));

import { HEALTHY_VIEW, getDeviceHealthSafe } from "@/lib/device-health";
import prisma from "@/lib/prisma";

/**
 * Pages about something else (dashboard, schedule) show device health as an
 * extra. A failed read must not take them down.
 */

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

	it("reads as healthy and logs when the database read fails", async () => {
		vi.mocked(prisma.deviceStateEvent.findFirst).mockRejectedValue(new Error("db down"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const view = await getDeviceHealthSafe("dev-1");

		expect(view).toEqual(HEALTHY_VIEW);
		expect(warn).toHaveBeenCalledWith("[device-health] read failed", "db down");
		warn.mockRestore();
	});
});
