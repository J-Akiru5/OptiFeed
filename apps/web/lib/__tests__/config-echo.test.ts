import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The device's config echo (issues #659, #660).
 *
 * One `config_rev` covers the whole `config` object and the firmware never
 * reports per-key values, so "applied" can only mean "this unit echoed a
 * config after the last recorded change". These checks pin that classification
 * and the tolerant readers, because the OTA card and the hopper filter card
 * both present the result as evidence.
 */

const { db } = vi.hoisted(() => ({
	db: {
		energyDevice: { findUnique: vi.fn() },
		deviceStateEvent: { findFirst: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import {
	CONFIG_APPLIED_EVENT,
	configEchoState,
	loadDeviceConfigEcho,
	loadDeviceEventAt,
	readConfigRev,
	readDiagSource,
} from "@/lib/settings/config-echo";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("configEchoState", () => {
	const changedAt = new Date("2026-11-03T10:00:00.000Z");

	it("names the four cases", () => {
		expect(configEchoState(null, changedAt)).toBe("never_reported");
		expect(configEchoState(new Date("2026-11-03T10:05:00.000Z"), null)).toBe("reported");
		expect(configEchoState(new Date("2026-11-03T10:05:00.000Z"), changedAt)).toBe("applied");
		expect(configEchoState(new Date("2026-11-03T09:55:00.000Z"), changedAt)).toBe("pending");
	});

	it("treats an echo at the exact change time as applied", () => {
		expect(configEchoState(changedAt, changedAt)).toBe("applied");
	});
});

describe("diag readers", () => {
	it("reads a documented config source and a non-negative revision", () => {
		expect(readDiagSource({ config_source: "server" })).toBe("server");
		expect(readDiagSource({ config_source: "nvs" })).toBe("nvs");
		expect(readDiagSource({ config_source: "default" })).toBe("default");
		expect(readDiagSource({ config_source: "elsewhere" })).toBeNull();
		expect(readDiagSource(null)).toBeNull();
		expect(readConfigRev({ config_rev: 1234 })).toBe(1234);
		expect(readConfigRev({ config_rev: -1 })).toBeNull();
		expect(readConfigRev({ config_rev: "1234" })).toBeNull();
		expect(readConfigRev([])).toBeNull();
	});
});

describe("loadDeviceConfigEcho", () => {
	it("combines the heartbeat echo with the newest applied row", async () => {
		const reportedAt = new Date("2026-11-03T10:05:00.000Z");
		db.energyDevice.findUnique.mockResolvedValue({
			diag: { config_rev: 999, config_source: "server" },
		});
		db.deviceStateEvent.findFirst.mockResolvedValue({ createdAt: reportedAt });

		await expect(loadDeviceConfigEcho("device-1")).resolves.toEqual({
			available: true,
			reportedAt,
			reportedRev: 999,
			configSource: "server",
		});
		expect(db.deviceStateEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { deviceId: "device-1", eventType: CONFIG_APPLIED_EVENT },
			}),
		);
	});

	it("reports unavailable rather than 'never reported' when the read fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		db.energyDevice.findUnique.mockRejectedValue(new Error("db down"));

		await expect(loadDeviceConfigEcho("device-1")).resolves.toEqual({
			available: false,
			reportedAt: null,
			reportedRev: null,
			configSource: null,
		});
		warn.mockRestore();
	});
});

describe("loadDeviceEventAt", () => {
	it("returns the newest event of one type, or null", async () => {
		const createdAt = new Date("2026-11-03T10:00:00.000Z");
		db.deviceStateEvent.findFirst.mockResolvedValue({ createdAt });
		await expect(loadDeviceEventAt("device-1", "hopper_filter_changed")).resolves.toBe(createdAt);

		db.deviceStateEvent.findFirst.mockResolvedValue(null);
		await expect(loadDeviceEventAt("device-1", "hopper_filter_changed")).resolves.toBeNull();
	});

	it("does not take the page down when the read fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		db.deviceStateEvent.findFirst.mockRejectedValue(new Error("db down"));

		await expect(loadDeviceEventAt("device-1", "hopper_filter_changed")).resolves.toBeNull();
		warn.mockRestore();
	});
});
