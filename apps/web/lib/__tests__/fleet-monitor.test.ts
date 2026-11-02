import { describe, expect, it } from "vitest";
import { deviceStatusPolicyFromValue } from "../device-status";
import {
	DEVICE_STATE_ORDER,
	FLEET_STATE_ORDER,
	type FleetDeviceInput,
	type TenantFleetRow,
	buildDeviceTelemetryRow,
	buildTenantFleetRows,
	firmwareFromDiag,
	isUnmeasured,
	readingFreshness,
	sortFleetRows,
	summarizeFleet,
	worstDevices,
} from "../platform/fleet-health-rules";
import {
	DEVICES_OFFLINE_CRITICAL_PCT,
	DEVICES_OFFLINE_DEGRADED_PCT,
} from "../platform/status-band-rules";

/**
 * Fleet monitor rules (issue #479, M3C.4 and M3C.4b).
 *
 * The point of these tests is that the monitor reuses the band thresholds
 * instead of inventing its own, that an unmeasured tenant can never read as
 * healthy — the same invariant the four status bands enforce — and, for the
 * per-device rows, that a value which was never reported stays missing instead
 * of becoming a zero or a green state.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

const MINUTE = 60 * 1000;

function ago(minutes: number): Date {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function device(overrides: Partial<FleetDeviceInput> = {}): FleetDeviceInput {
	return {
		id: `dev-${Math.random().toString(36).slice(2, 8)}`,
		label: "Feeder",
		mac: "AA:BB:CC:DD:EE:FF",
		lastSeenAt: ago(1),
		tenantId: "org-1",
		tenantName: "Alpha",
		pondName: "Pond 1",
		...overrides,
	};
}

function silent(count: number, tenantId = "org-1"): FleetDeviceInput[] {
	return Array.from({ length: count }, () =>
		device({ tenantId, tenantName: tenantId === "org-1" ? "Alpha" : "Beta", lastSeenAt: null }),
	);
}

/** A tenant row for the ordering/summary tests, which do not build devices. */
function tenantRow(overrides: Partial<TenantFleetRow> = {}): TenantFleetRow {
	return {
		tenantId: "org-1",
		tenantName: "Alpha",
		total: 1,
		reporting: 1,
		online: 1,
		weak: 0,
		offline: 0,
		offlinePct: 0,
		lastHeartbeatAt: NOW,
		state: "ok",
		devices: [],
		...overrides,
	};
}

describe("buildTenantFleetRows", () => {
	it("groups devices by tenant and counts the connectivity buckets", () => {
		const rows = buildTenantFleetRows(
			[
				device({ tenantId: "org-1", tenantName: "Alpha" }),
				device({ tenantId: "org-1", tenantName: "Alpha", lastSeenAt: null }),
				device({ tenantId: "org-2", tenantName: "Beta" }),
			],
			NOW,
			POLICY,
		);

		const alpha = rows.find((row) => row.tenantId === "org-1");
		const beta = rows.find((row) => row.tenantId === "org-2");
		expect(alpha).toMatchObject({ total: 2, reporting: 1, online: 1, offline: 1 });
		expect(beta).toMatchObject({ total: 1, reporting: 1 });
		expect(alpha?.lastHeartbeatAt).toBeInstanceOf(Date);
		// The units travel with the tenant row so the page can show the evidence.
		expect(alpha?.devices).toHaveLength(2);
		expect(alpha?.devices[0]?.connection).toBe("offline");
	});

	it("calls a tenant whose units never reported unmeasured and unknown, never ok", () => {
		const [row] = buildTenantFleetRows(silent(3), NOW, POLICY);
		expect(row?.reporting).toBe(0);
		expect(row?.offlinePct).toBeNull();
		expect(row?.state).toBe("unknown");
		expect(row).toBeDefined();
		if (row) expect(isUnmeasured(row)).toBe(true);
	});

	it("uses the band thresholds: degraded at the degraded share, critical at the critical share", () => {
		const degraded = buildTenantFleetRows(
			Array.from({ length: 100 }, (_, index) =>
				device({ lastSeenAt: index < DEVICES_OFFLINE_DEGRADED_PCT ? null : NOW }),
			),
			NOW,
			POLICY,
		)[0];
		const critical = buildTenantFleetRows(
			Array.from({ length: 100 }, (_, index) =>
				device({ lastSeenAt: index < DEVICES_OFFLINE_CRITICAL_PCT ? null : NOW }),
			),
			NOW,
			POLICY,
		)[0];

		expect(degraded?.state).toBe("degraded");
		expect(critical?.state).toBe("critical");
	});

	it("takes the offline window from the supplied policy rather than a default", () => {
		const lastSeenAt = ago(10);
		const tight = deviceStatusPolicyFromValue({ weakAfterMin: 1, offlineAfterMin: 5, graceMin: 0 });
		const loose = deviceStatusPolicyFromValue({
			weakAfterMin: 1,
			offlineAfterMin: 30,
			graceMin: 0,
		});

		expect(buildTenantFleetRows([device({ lastSeenAt })], NOW, tight)[0]?.state).toBe("critical");
		expect(buildTenantFleetRows([device({ lastSeenAt })], NOW, loose)[0]?.state).toBe("ok");
	});

	it("keeps devices without a tenant in one unassigned row", () => {
		const rows = buildTenantFleetRows(
			[
				device({ tenantId: null, tenantName: null, pondName: null }),
				device({ tenantId: null, tenantName: null, pondName: null }),
			],
			NOW,
			POLICY,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.tenantId).toBeNull();
		expect(rows[0]?.total).toBe(2);
	});

	it("counts each unit exactly once, from the same evaluation the device row shows", () => {
		const [row] = buildTenantFleetRows(
			[
				device({ lastSeenAt: ago(1) }),
				device({ lastSeenAt: ago(4.5) }),
				device({ lastSeenAt: ago(9) }),
			],
			NOW,
			POLICY,
		);

		expect(row).toMatchObject({ online: 1, weak: 1, offline: 1 });
		expect(row?.devices.map((unit) => unit.connection)).toEqual(["offline", "weak", "online"]);
	});
});

describe("readingFreshness", () => {
	it("says none when there was never a reading", () => {
		expect(readingFreshness(null, NOW, POLICY)).toBe("none");
		expect(readingFreshness(undefined, NOW, POLICY)).toBe("none");
	});

	it("keeps a reading inside the configured display window fresh", () => {
		expect(readingFreshness(ago(1), NOW, POLICY)).toBe("fresh");
		// Still inside the weak band, which the console does not call offline.
		expect(readingFreshness(ago(4.5), NOW, POLICY)).toBe("fresh");
	});

	it("marks a reading stale exactly when a heartbeat of that age would be offline", () => {
		expect(readingFreshness(ago(9), NOW, POLICY)).toBe("stale");
	});

	it("follows the supplied policy instead of a hard-coded window", () => {
		const loose = deviceStatusPolicyFromValue({
			weakAfterMin: 4,
			offlineAfterMin: 30,
			graceMin: 0,
		});
		expect(readingFreshness(ago(9), NOW, loose)).toBe("fresh");
	});

	it("includes the configured grace in the window", () => {
		const graced = deviceStatusPolicyFromValue({
			weakAfterMin: 4,
			offlineAfterMin: 5,
			graceMin: 3,
		});
		expect(readingFreshness(ago(7), NOW, graced)).toBe("fresh");
		expect(readingFreshness(ago(9), NOW, graced)).toBe("stale");
	});
});

describe("firmwareFromDiag", () => {
	it("reads the version firmware 1.6.0+ sends on the heartbeat", () => {
		expect(firmwareFromDiag({ fw: "1.6.2" })).toBe("1.6.2");
	});

	it("refuses anything that is not a short non-empty string", () => {
		expect(firmwareFromDiag(null)).toBeNull();
		expect(firmwareFromDiag("1.6.2")).toBeNull();
		expect(firmwareFromDiag({})).toBeNull();
		expect(firmwareFromDiag({ fw: "  " })).toBeNull();
		expect(firmwareFromDiag({ fw: 162 })).toBeNull();
		expect(firmwareFromDiag({ fw: "1".repeat(33) })).toBeNull();
	});
});

describe("buildDeviceTelemetryRow", () => {
	it("reports every value the unit actually sent", () => {
		const row = buildDeviceTelemetryRow(
			device({
				diag: { fw: "1.6.2", faults_present: 0 },
				rssiDbm: -62,
				rssiUpdatedAt: ago(1),
				feedLevelPercent: 64.4,
				feedLevelUpdatedAt: ago(2),
				waterTempC: 27.4,
				waterTempOk: true,
				waterTempUpdatedAt: ago(2),
				lastFeedAt: ago(30),
				health: {
					metadata: { safeMode: false, faultsPresent: 0, faultsLatched: 0 },
					createdAt: ago(60 * 24),
				},
			}),
			NOW,
			POLICY,
		);

		expect(row).toMatchObject({
			connection: "online",
			rssiDbm: -62,
			rssiFreshness: "fresh",
			firmware: { version: "1.6.2", at: ago(1), source: "diag" },
			lastFeedAt: ago(30),
			feedLevel: { percent: 64.4, at: ago(2), freshness: "fresh" },
			waterTemp: { celsius: 27.4, at: ago(2), freshness: "fresh", probeOk: true },
			health: { safeMode: false, faults: [], since: ago(60 * 24) },
		});
	});

	it("keeps a unit that never reported anything missing, never zero", () => {
		const row = buildDeviceTelemetryRow(device({ lastSeenAt: null }), NOW, POLICY);

		expect(row).toMatchObject({
			connection: "offline",
			lastHeartbeatAt: null,
			rssiDbm: null,
			rssiFreshness: "none",
			firmware: { version: null, at: null, source: null },
			lastFeedAt: null,
			feedLevel: { percent: null, at: null, freshness: "none" },
			waterTemp: null,
			health: null,
		});
		// The distinction that matters: no health row is not "all clear".
		expect(row.health).not.toEqual({ safeMode: false, faults: [], since: expect.anything() });
	});

	it("drops a signal reading that has timed out instead of showing it as current", () => {
		const row = buildDeviceTelemetryRow(
			device({ rssiDbm: -62, rssiUpdatedAt: ago(30) }),
			NOW,
			POLICY,
		);

		expect(row.rssiDbm).toBeNull();
		expect(row.rssiFreshness).toBe("stale");
		// The reading is still dated, so the operator knows how old it is.
		expect(row.rssiAt).toEqual(ago(30));
	});

	it("treats an implausible RSSI as never reported", () => {
		const row = buildDeviceTelemetryRow(
			device({ rssiDbm: -300, rssiUpdatedAt: ago(1) }),
			NOW,
			POLICY,
		);

		expect(row.rssiDbm).toBeNull();
		expect(row.rssiFreshness).toBe("none");
	});

	it("prefers the heartbeat diagnostics and falls back to the newest version event", () => {
		const withDiag = buildDeviceTelemetryRow(
			device({
				diag: { fw: "1.6.2" },
				firmwareEvent: { version: "1.4.0", createdAt: ago(60 * 24) },
			}),
			NOW,
			POLICY,
		);
		expect(withDiag.firmware).toMatchObject({ version: "1.6.2", source: "diag" });

		// Older firmware sends no diag at all; the event stream still knows.
		const fromEvent = buildDeviceTelemetryRow(
			device({ firmwareEvent: { version: "1.4.0", createdAt: ago(60 * 24) } }),
			NOW,
			POLICY,
		);
		expect(fromEvent.firmware).toEqual({
			version: "1.4.0",
			at: ago(60 * 24),
			source: "event",
		});

		// A row that carries no usable version is not invented either.
		const unusable = buildDeviceTelemetryRow(
			device({ firmwareEvent: { version: null, createdAt: ago(60 * 24) } }),
			NOW,
			POLICY,
		);
		expect(unusable.firmware).toEqual({ version: null, at: ago(60 * 24), source: null });
	});

	it("shows faults and safe mode as the unit reported them", () => {
		const row = buildDeviceTelemetryRow(
			device({
				health: {
					metadata: { safeMode: true, faultsPresent: 2 | 4 | 16, faultsLatched: 2 | 4 | 16 },
					createdAt: ago(5),
				},
			}),
			NOW,
			POLICY,
		);

		expect(row.health).toEqual({
			safeMode: true,
			// Safe mode has its own flag, so it is not listed twice as a fault.
			faults: ["hopper_sensor", "rtc"],
			since: ago(5),
		});
	});

	it("reports a stale hopper or water reading as stale, not as current", () => {
		const row = buildDeviceTelemetryRow(
			device({
				feedLevelPercent: 20,
				feedLevelUpdatedAt: ago(40),
				waterTempC: 26,
				waterTempOk: false,
				waterTempUpdatedAt: ago(40),
			}),
			NOW,
			POLICY,
		);

		expect(row.feedLevel.freshness).toBe("stale");
		expect(row.waterTemp).toMatchObject({ freshness: "stale", probeOk: false });
	});
});

describe("worstDevices", () => {
	it("ranks every unit across tenants: silent first, then weak, then online", () => {
		const rows = buildTenantFleetRows(
			[
				device({ label: "Beta 1", tenantId: "org-2", tenantName: "Beta" }),
				device({ label: "Alpha silent", tenantId: "org-1", tenantName: "Alpha", lastSeenAt: null }),
				device({
					label: "Alpha weak",
					tenantId: "org-1",
					tenantName: "Alpha",
					lastSeenAt: ago(4.5),
				}),
				device({ label: "Alpha online", tenantId: "org-1", tenantName: "Alpha" }),
			],
			NOW,
			POLICY,
		);

		expect(worstDevices(rows).map((unit) => unit.label)).toEqual([
			"Alpha silent",
			"Alpha weak",
			"Alpha online",
			"Beta 1",
		]);
		expect(DEVICE_STATE_ORDER.offline).toBeLessThan(DEVICE_STATE_ORDER.online);
	});
});

describe("sortFleetRows", () => {
	it("puts the worst state first and orders ties by tenant name", () => {
		const rows: TenantFleetRow[] = [
			tenantRow({ tenantId: "c", tenantName: "Charlie" }),
			tenantRow({
				tenantId: "a",
				tenantName: "Alpha",
				reporting: 0,
				online: 0,
				offline: 1,
				offlinePct: null,
				lastHeartbeatAt: null,
				state: "unknown",
			}),
			tenantRow({
				tenantId: "b",
				tenantName: "Bravo",
				online: 0,
				offline: 1,
				offlinePct: 100,
				state: "critical",
			}),
			tenantRow({ tenantId: "d", tenantName: "Delta", online: 0, weak: 1, state: "degraded" }),
		];

		expect(sortFleetRows(rows).map((row) => row.tenantId)).toEqual(["b", "d", "a", "c"]);
		expect(FLEET_STATE_ORDER.critical).toBeLessThan(FLEET_STATE_ORDER.unknown);
	});
});

describe("summarizeFleet", () => {
	it("is unknown when there are no devices to measure", () => {
		const summary = summarizeFleet([]);
		expect(summary.state).toBe("unknown");
		expect(summary.counts).toEqual({ ok: 0, degraded: 0, critical: 0, unknown: 0 });
	});

	it("never lets an unknown tenant be hidden behind healthy ones", () => {
		const rows: TenantFleetRow[] = [
			tenantRow({ tenantId: "a", tenantName: "Alpha", total: 5, online: 5 }),
			tenantRow({
				tenantId: "b",
				tenantName: "Beta",
				total: 2,
				reporting: 0,
				online: 0,
				offline: 2,
				offlinePct: null,
				lastHeartbeatAt: null,
				state: "unknown",
			}),
		];
		const summary = summarizeFleet(rows);
		expect(summary.state).toBe("unknown");
		expect(summary.state).not.toBe("ok");
		expect(summary.counts).toEqual({ ok: 1, degraded: 0, critical: 0, unknown: 1 });
	});

	it("reports the worst tenant, not an average of them", () => {
		const rows: TenantFleetRow[] = [
			tenantRow({ tenantId: "a", tenantName: "Alpha", total: 10, online: 10 }),
			tenantRow({
				tenantId: "b",
				tenantName: "Beta",
				total: 10,
				online: 0,
				offline: 10,
				offlinePct: 100,
				state: "critical",
			}),
		];
		expect(summarizeFleet(rows).state).toBe("critical");
	});
});
