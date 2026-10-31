import {
	HEALTHY_VIEW,
	buildHealthView,
	deviceNeedsAttention,
	faultsFromMask,
	healthAlertFor,
	healthChanged,
	healthEventMetadata,
	healthFromMetadata,
	isHealthClear,
	parseDeviceHealthReport,
} from "@/lib/device-health-model";
import { describe, expect, it } from "vitest";

/**
 * Device faults and safe mode as the unit reports them. The rules that matter:
 * an old unit that reports nothing is not "all clear", a malformed field never
 * fails a heartbeat, and a row is written only when the state changes.
 */

const CLEAR = { safeMode: false, faultsPresent: 0, faultsLatched: 0 };

describe("faultsFromMask", () => {
	it("maps firmware bit n to fw::Fault n", () => {
		expect(faultsFromMask(1 << 1)).toEqual(["hopper_sensor"]);
		expect(faultsFromMask(1 << 2)).toEqual(["rtc"]);
		expect(faultsFromMask(1 << 3)).toEqual(["relay_overrun"]);
		expect(faultsFromMask(1 << 4)).toEqual(["safe_mode"]);
		expect(faultsFromMask((1 << 1) | (1 << 4))).toEqual(["hopper_sensor", "safe_mode"]);
	});

	it("ignores zero, bit 0, unknown bits and non-integers", () => {
		expect(faultsFromMask(0)).toEqual([]);
		expect(faultsFromMask(1)).toEqual([]);
		expect(faultsFromMask(1 << 7)).toEqual([]);
		expect(faultsFromMask(-4)).toEqual([]);
		expect(faultsFromMask(2.5)).toEqual([]);
	});
});

describe("parseDeviceHealthReport", () => {
	it("reads the 1.8.x heartbeat fields", () => {
		const report = parseDeviceHealthReport({
			safe_mode: true,
			last_reset_reasons: "brownout,task_wdt",
			diag: {
				safe_mode: true,
				faults_present: 18,
				faults_latched: 18,
				last_fault: "safe_mode",
				reset_abnormal_count: 3,
			},
		});
		expect(report).toEqual({
			safeMode: true,
			faultsPresent: 18,
			faultsLatched: 18,
			lastFault: "safe_mode",
			abnormalResets: 3,
			resetReasons: "brownout,task_wdt",
		});
	});

	it("returns null for older firmware that reports nothing", () => {
		expect(parseDeviceHealthReport({ rtc_ok: true, feeder_active: false })).toBeNull();
		expect(parseDeviceHealthReport({ diag: { fw: "1.5.0" } })).toBeNull();
		expect(parseDeviceHealthReport(null)).toBeNull();
		expect(parseDeviceHealthReport("heartbeat")).toBeNull();
	});

	it("treats a 1.6.x unit that only sends safe_mode as reporting", () => {
		expect(parseDeviceHealthReport({ safe_mode: false })).toMatchObject({
			safeMode: false,
			faultsPresent: 0,
		});
	});

	it("drops malformed fields instead of failing", () => {
		const report = parseDeviceHealthReport({
			safe_mode: "yes",
			diag: {
				safe_mode: false,
				faults_present: "lots",
				faults_latched: 99999,
				last_fault: 7,
				reset_abnormal_count: -1,
			},
			last_reset_reasons: 12,
		});
		expect(report).toEqual({
			safeMode: false,
			faultsPresent: 0,
			faultsLatched: 0,
			lastFault: null,
			abnormalResets: 0,
			resetReasons: null,
		});
	});

	it("caps free text so a bad unit cannot store a novel", () => {
		const report = parseDeviceHealthReport({
			safe_mode: false,
			last_reset_reasons: "x".repeat(500),
			diag: { faults_present: 0, last_fault: "y".repeat(500) },
		});
		expect(report?.resetReasons).toHaveLength(64);
		expect(report?.lastFault).toHaveLength(32);
	});
});

describe("healthChanged", () => {
	it("does not write a row for a healthy first contact", () => {
		expect(healthChanged(null, CLEAR)).toBe(false);
	});

	it("writes a row when a fault or safe mode first appears", () => {
		expect(healthChanged(null, { ...CLEAR, safeMode: true })).toBe(true);
		expect(healthChanged(null, { ...CLEAR, faultsPresent: 2 })).toBe(true);
	});

	it("writes nothing while the state stays the same", () => {
		const state = { safeMode: true, faultsPresent: 16, faultsLatched: 16 };
		expect(healthChanged(state, { ...state })).toBe(false);
	});

	it("writes a row when the state clears, so the dashboard stops warning", () => {
		expect(healthChanged({ safeMode: true, faultsPresent: 16, faultsLatched: 16 }, CLEAR)).toBe(
			true,
		);
	});

	it("writes a row when a latched fault is acknowledged but the cause remains", () => {
		expect(
			healthChanged(
				{ safeMode: false, faultsPresent: 2, faultsLatched: 2 },
				{ safeMode: false, faultsPresent: 2, faultsLatched: 0 },
			),
		).toBe(true);
	});
});

describe("stored rows", () => {
	it("round-trips a report through the event metadata", () => {
		const report = {
			safeMode: true,
			faultsPresent: 18,
			faultsLatched: 18,
			lastFault: "safe_mode",
			abnormalResets: 3,
			resetReasons: "brownout",
		};
		const metadata = healthEventMetadata(report);
		expect(metadata.present).toEqual(["hopper_sensor", "safe_mode"]);
		expect(healthFromMetadata(metadata)).toEqual(report);
	});

	it("reads an unreadable row as clear", () => {
		expect(isHealthClear(healthFromMetadata(null))).toBe(true);
		expect(isHealthClear(healthFromMetadata("garbage"))).toBe(true);
	});
});

describe("healthAlertFor", () => {
	const report = (over: Partial<Parameters<typeof healthAlertFor>[2]> = {}) => ({
		safeMode: false,
		faultsPresent: 0,
		faultsLatched: 0,
		lastFault: null,
		abnormalResets: 0,
		resetReasons: null,
		...over,
	});

	it("raises a critical alert when safe mode starts", () => {
		const alert = healthAlertFor("Feeder A", CLEAR, report({ safeMode: true, faultsPresent: 16 }));
		expect(alert?.tier).toBe("CRITICAL");
		expect(alert?.message).toContain("Feeder A is in safe mode");
	});

	it("does not repeat the alert while safe mode continues", () => {
		const inSafeMode = { safeMode: true, faultsPresent: 16, faultsLatched: 16 };
		expect(
			healthAlertFor("Feeder A", inSafeMode, report({ safeMode: true, faultsPresent: 16 })),
		).toBe(null);
	});

	it("warns about a new sensor fault and names it", () => {
		const alert = healthAlertFor("Feeder A", CLEAR, report({ faultsPresent: (1 << 1) | (1 << 2) }));
		expect(alert?.tier).toBe("WARNING");
		expect(alert?.message).toContain("hopper sensor");
		expect(alert?.message).toContain("clock");
	});

	it("stays quiet when a fault clears", () => {
		expect(
			healthAlertFor("Feeder A", { safeMode: false, faultsPresent: 2, faultsLatched: 2 }, report()),
		).toBeNull();
	});
});

describe("buildHealthView", () => {
	const now = new Date("2026-11-01T12:00:00Z");
	const at = (iso: string) => new Date(iso);

	it("is healthy with no rows", () => {
		const view = buildHealthView({ health: null, refusal: null, now });
		expect(view).toEqual(HEALTHY_VIEW);
		expect(deviceNeedsAttention(view)).toBe(false);
	});

	it("shows safe mode and active faults, with safe mode kept out of the fault list", () => {
		const view = buildHealthView({
			health: {
				metadata: healthEventMetadata({
					safeMode: true,
					faultsPresent: (1 << 1) | (1 << 4),
					faultsLatched: (1 << 1) | (1 << 4),
					lastFault: "safe_mode",
					abnormalResets: 3,
					resetReasons: "brownout",
				}),
				createdAt: at("2026-11-01T11:30:00Z"),
			},
			refusal: null,
			now,
		});
		expect(view.safeMode).toBe(true);
		expect(view.faults).toEqual(["hopper_sensor"]);
		expect(view.resetReasons).toBe("brownout");
		expect(view.since).toEqual(at("2026-11-01T11:30:00Z"));
		expect(deviceNeedsAttention(view)).toBe(true);
	});

	it("goes back to healthy after a clear row", () => {
		const view = buildHealthView({
			health: {
				metadata: healthEventMetadata({
					safeMode: false,
					faultsPresent: 0,
					faultsLatched: 0,
					lastFault: null,
					abnormalResets: 0,
					resetReasons: null,
				}),
				createdAt: at("2026-11-01T11:45:00Z"),
			},
			refusal: null,
			now,
		});
		expect(deviceNeedsAttention(view)).toBe(false);
		expect(view.since).toBeNull();
	});

	it("keeps a recent refused dose and drops one older than a day", () => {
		const metadata = { reason: "safe_mode", source: "dashboard", grams: 150 };
		const recent = buildHealthView({
			health: null,
			refusal: { metadata, createdAt: at("2026-11-01T10:00:00Z") },
			now,
		});
		expect(recent.lastRefusal).toMatchObject({
			reason: "safe_mode",
			source: "dashboard",
			grams: 150,
		});

		const old = buildHealthView({
			health: null,
			refusal: { metadata, createdAt: at("2026-10-30T10:00:00Z") },
			now,
		});
		expect(old.lastRefusal).toBeNull();
	});

	it("ignores a refusal row with no reason", () => {
		const view = buildHealthView({
			health: null,
			refusal: { metadata: { source: "button" }, createdAt: at("2026-11-01T11:00:00Z") },
			now,
		});
		expect(view.lastRefusal).toBeNull();
	});
});
