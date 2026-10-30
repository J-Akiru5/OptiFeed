import { describe, expect, it } from "vitest";

import {
	DEFAULT_DEVICE_STATUS_POLICY,
	DEVICE_OFFLINE_AFTER_MIN_DEFAULT,
	DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
	DEVICE_WEAK_AFTER_MIN_DEFAULT,
	DEVICE_WEAK_RSSI_DBM,
	deviceStatusPolicyFromValue,
	evaluateDeviceStatus,
	isDeviceOffline,
	isDeviceUnreachable,
	isValidDeviceStatusValue,
	normalizeDeviceStatusValue,
} from "@/lib/device-status";

/**
 * #388: one three-state rule, with a grace window so a single late heartbeat
 * never flips a feeder to offline, and a separate stricter safety rule for
 * command acceptance.
 */

const now = new Date("2026-10-30T12:00:00.000Z");
const MINUTE = 60 * 1000;

function ago(minutes: number): Date {
	return new Date(now.getTime() - minutes * MINUTE);
}

describe("evaluateDeviceStatus", () => {
	it.each([
		// silence, expected state
		[0, "online"],
		[DEVICE_WEAK_AFTER_MIN_DEFAULT, "online"],
		[DEVICE_WEAK_AFTER_MIN_DEFAULT + 0.01, "weak"],
		[DEVICE_OFFLINE_AFTER_MIN_DEFAULT, "weak"],
		[DEVICE_OFFLINE_AFTER_MIN_DEFAULT + DEVICE_OFFLINE_GRACE_MIN_DEFAULT, "weak"],
		[DEVICE_OFFLINE_AFTER_MIN_DEFAULT + DEVICE_OFFLINE_GRACE_MIN_DEFAULT + 0.01, "offline"],
	] as const)("grades %s minutes of silence as %s", (minutes, expected) => {
		expect(evaluateDeviceStatus({ lastSeenAt: ago(minutes), now }).state).toBe(expected);
	});

	it("treats a device that never reported as offline", () => {
		expect(evaluateDeviceStatus({ lastSeenAt: null, now }).state).toBe("offline");
	});

	it("shows weak signal when a recent heartbeat reports a low RSSI", () => {
		expect(
			evaluateDeviceStatus({ lastSeenAt: ago(0.5), now, rssiDbm: DEVICE_WEAK_RSSI_DBM }).state,
		).toBe("weak");
		expect(
			evaluateDeviceStatus({ lastSeenAt: ago(0.5), now, rssiDbm: DEVICE_WEAK_RSSI_DBM + 1 }).state,
		).toBe("online");
	});

	it("never shows offline while a command is in flight", () => {
		const result = evaluateDeviceStatus({ lastSeenAt: ago(240), now, inFlight: true });

		expect(result.state).toBe("online");
		expect(result.inFlight).toBe(true);
		expect(result.isOffline).toBe(false);
	});

	it("applies hysteresis: an offline unit does not bounce to weak at the boundary", () => {
		// Silence is inside the grace band, but the previous render was offline.
		expect(
			evaluateDeviceStatus({
				lastSeenAt: ago(DEVICE_OFFLINE_AFTER_MIN_DEFAULT + 1),
				now,
				previousState: "offline",
			}).state,
		).toBe("offline");

		// A heartbeat clearly inside the healthy window leaves offline normally.
		expect(
			evaluateDeviceStatus({
				lastSeenAt: ago(1),
				now,
				previousState: "offline",
			}).state,
		).toBe("online");
	});

	it("honours a custom policy", () => {
		const policy = deviceStatusPolicyFromValue({
			weakAfterMin: 10,
			offlineAfterMin: 60,
			graceMin: 5,
		});

		expect(evaluateDeviceStatus({ lastSeenAt: ago(11), now, policy }).state).toBe("weak");
		expect(evaluateDeviceStatus({ lastSeenAt: ago(64), now, policy }).state).toBe("weak");
		expect(evaluateDeviceStatus({ lastSeenAt: ago(66), now, policy }).state).toBe("offline");
	});
});

describe("isDeviceUnreachable (command safety)", () => {
	it("is stricter than the display rule: no grace for command acceptance", () => {
		const justInsideGrace = ago(DEVICE_OFFLINE_AFTER_MIN_DEFAULT + 1);

		expect(isDeviceOffline(justInsideGrace, now)).toBe(false);
		expect(isDeviceUnreachable(justInsideGrace, now)).toBe(true);
	});

	it("rejects at the offline boundary and for a device that never reported", () => {
		expect(isDeviceUnreachable(ago(DEVICE_OFFLINE_AFTER_MIN_DEFAULT), now)).toBe(false);
		expect(isDeviceUnreachable(ago(DEVICE_OFFLINE_AFTER_MIN_DEFAULT + 0.01), now)).toBe(true);
		expect(isDeviceUnreachable(null, now)).toBe(true);
	});
});

describe("normalizeDeviceStatusValue", () => {
	it("keeps a valid stored value", () => {
		expect(
			normalizeDeviceStatusValue({ weakAfterMin: 3, offlineAfterMin: 20, graceMin: 4 }),
		).toEqual({ weakAfterMin: 3, offlineAfterMin: 20, graceMin: 4 });
	});

	it("falls back to the defaults for missing or malformed input", () => {
		expect(normalizeDeviceStatusValue(undefined)).toEqual({
			weakAfterMin: DEVICE_WEAK_AFTER_MIN_DEFAULT,
			offlineAfterMin: DEVICE_OFFLINE_AFTER_MIN_DEFAULT,
			graceMin: DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
		});
		expect(normalizeDeviceStatusValue("nope")).toEqual({
			weakAfterMin: DEVICE_WEAK_AFTER_MIN_DEFAULT,
			offlineAfterMin: DEVICE_OFFLINE_AFTER_MIN_DEFAULT,
			graceMin: DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
		});
	});

	it("normalises each bad field independently and keeps weak below offline", () => {
		expect(
			normalizeDeviceStatusValue({ weakAfterMin: 30, offlineAfterMin: 15, graceMin: -1 }),
		).toEqual({
			weakAfterMin: 14,
			offlineAfterMin: 15,
			graceMin: DEVICE_OFFLINE_GRACE_MIN_DEFAULT,
		});
		expect(
			normalizeDeviceStatusValue({ weakAfterMin: 0, offlineAfterMin: 5, graceMin: 99 }),
		).toEqual({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: DEVICE_OFFLINE_GRACE_MIN_DEFAULT });
	});

	it("rejects impossible values in the write validator", () => {
		expect(isValidDeviceStatusValue({ weakAfterMin: 5, offlineAfterMin: 15, graceMin: 2 })).toBe(
			true,
		);
		expect(isValidDeviceStatusValue({ weakAfterMin: 15, offlineAfterMin: 15, graceMin: 2 })).toBe(
			false,
		);
		expect(isValidDeviceStatusValue({ weakAfterMin: 5, offlineAfterMin: 4, graceMin: 2 })).toBe(
			false,
		);
	});
});

describe("defaults", () => {
	it("matches the documented 5 / 15 / 2 minute policy", () => {
		expect(DEFAULT_DEVICE_STATUS_POLICY).toEqual({
			weakAfterMs: 5 * MINUTE,
			offlineAfterMs: 15 * MINUTE,
			graceMs: 2 * MINUTE,
		});
	});
});
