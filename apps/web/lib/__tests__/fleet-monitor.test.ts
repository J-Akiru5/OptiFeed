import { describe, expect, it } from "vitest";
import { deviceStatusPolicyFromValue } from "../device-status";
import {
	FLEET_STATE_ORDER,
	type FleetDeviceInput,
	type TenantFleetRow,
	buildTenantFleetRows,
	isUnmeasured,
	sortFleetRows,
	summarizeFleet,
} from "../platform/fleet-health-rules";
import {
	DEVICES_OFFLINE_CRITICAL_PCT,
	DEVICES_OFFLINE_DEGRADED_PCT,
} from "../platform/status-band-rules";

/**
 * Fleet monitor rules (issue #479, M3C.4).
 *
 * The point of these tests is that the monitor reuses the band thresholds
 * instead of inventing its own, and that an unmeasured tenant can never read as
 * healthy — the same invariant the four status bands enforce.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

const MINUTE = 60 * 1000;

function device(overrides: Partial<FleetDeviceInput> = {}): FleetDeviceInput {
	return {
		id: `dev-${Math.random().toString(36).slice(2, 8)}`,
		label: "Feeder",
		mac: "AA:BB:CC:DD:EE:FF",
		lastSeenAt: new Date(NOW.getTime() - MINUTE),
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
		const lastSeenAt = new Date(NOW.getTime() - 10 * MINUTE);
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
});

describe("sortFleetRows", () => {
	it("puts the worst state first and orders ties by tenant name", () => {
		const rows: TenantFleetRow[] = [
			{
				tenantId: "c",
				tenantName: "Charlie",
				total: 1,
				reporting: 1,
				online: 1,
				weak: 0,
				offline: 0,
				offlinePct: 0,
				lastHeartbeatAt: NOW,
				state: "ok",
			},
			{
				tenantId: "a",
				tenantName: "Alpha",
				total: 1,
				reporting: 0,
				online: 0,
				weak: 0,
				offline: 1,
				offlinePct: null,
				lastHeartbeatAt: null,
				state: "unknown",
			},
			{
				tenantId: "b",
				tenantName: "Bravo",
				total: 1,
				reporting: 1,
				online: 0,
				weak: 0,
				offline: 1,
				offlinePct: 100,
				lastHeartbeatAt: NOW,
				state: "critical",
			},
			{
				tenantId: "d",
				tenantName: "Delta",
				total: 1,
				reporting: 1,
				online: 0,
				weak: 1,
				offline: 0,
				offlinePct: 0,
				lastHeartbeatAt: NOW,
				state: "degraded",
			},
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
			{
				tenantId: "a",
				tenantName: "Alpha",
				total: 5,
				reporting: 5,
				online: 5,
				weak: 0,
				offline: 0,
				offlinePct: 0,
				lastHeartbeatAt: NOW,
				state: "ok",
			},
			{
				tenantId: "b",
				tenantName: "Beta",
				total: 2,
				reporting: 0,
				online: 0,
				weak: 0,
				offline: 2,
				offlinePct: null,
				lastHeartbeatAt: null,
				state: "unknown",
			},
		];
		const summary = summarizeFleet(rows);
		expect(summary.state).toBe("unknown");
		expect(summary.state).not.toBe("ok");
		expect(summary.counts).toEqual({ ok: 1, degraded: 0, critical: 0, unknown: 1 });
	});

	it("reports the worst tenant, not an average of them", () => {
		const rows: TenantFleetRow[] = [
			{
				tenantId: "a",
				tenantName: "Alpha",
				total: 10,
				reporting: 10,
				online: 10,
				weak: 0,
				offline: 0,
				offlinePct: 0,
				lastHeartbeatAt: NOW,
				state: "ok",
			},
			{
				tenantId: "b",
				tenantName: "Beta",
				total: 10,
				reporting: 10,
				online: 0,
				weak: 0,
				offline: 10,
				offlinePct: 100,
				lastHeartbeatAt: NOW,
				state: "critical",
			},
		];
		expect(summarizeFleet(rows).state).toBe("critical");
	});
});
