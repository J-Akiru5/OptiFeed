import { describe, expect, it } from "vitest";
import { deviceStatusPolicyFromValue } from "../device-status";
import {
	type TenantHealthInput,
	buildTenantHealthRows,
	paginateTenantRows,
	sortTenantHealthRows,
	summarizeTenants,
} from "../platform/tenant-health-rules";

/**
 * Tenant health rules (issue #479, M3C.3).
 *
 * The table's claims: a tenant's state is the band rule applied to its fleet
 * (not a new threshold), a tenant with nothing to measure is Unknown rather than
 * OK, and the worst tenants are the ones on page 1.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function tenant(overrides: Partial<TenantHealthInput> & { orgId: string }): TenantHealthInput {
	return {
		orgName: `Tenant ${overrides.orgId}`,
		orgStatus: "ACTIVE",
		members: 2,
		ponds: 1,
		devices: [],
		openAlerts: 0,
		...overrides,
	};
}

function devices(...lastSeen: (Date | null)[]) {
	return lastSeen.map((seen, index) => ({ id: `d${index}`, lastSeenAt: seen }));
}

describe("buildTenantHealthRows", () => {
	it("uses the band thresholds: 25 % offline is degraded, 50 % is critical", () => {
		const rows = buildTenantHealthRows(
			[
				tenant({
					orgId: "a",
					devices: devices(ago(30), ago(1), ago(1), ago(1)),
				}),
				tenant({
					orgId: "b",
					devices: devices(ago(30), ago(30), ago(1), ago(1)),
				}),
			],
			NOW,
			POLICY,
		);
		const byId = Object.fromEntries(rows.map((row) => [row.orgId, row]));
		expect(byId.a?.state).toBe("degraded");
		expect(byId.a?.offline).toBe(1);
		expect(byId.a?.offlinePct).toBe(25);
		expect(byId.b?.state).toBe("critical");
	});

	it("never calls a tenant with nothing to measure healthy", () => {
		const rows = buildTenantHealthRows(
			[tenant({ orgId: "empty" }), tenant({ orgId: "silent", devices: devices(null, null) })],
			NOW,
			POLICY,
		);
		expect(rows.map((row) => row.state)).toEqual(["unknown", "unknown"]);
		expect(rows.every((row) => row.offlinePct === null)).toBe(true);
	});

	it("reports a suspended tenant as degraded even when its feeders are online", () => {
		const [row] = buildTenantHealthRows(
			[tenant({ orgId: "s", orgStatus: "SUSPENDED", devices: devices(ago(1), ago(1)) })],
			NOW,
			POLICY,
		);
		expect(row?.deviceState).toBe("ok");
		expect(row?.state).toBe("degraded");
	});

	it("keeps the healthy tenant ok and records its last heartbeat and alerts", () => {
		const [row] = buildTenantHealthRows(
			[
				tenant({
					orgId: "h",
					ponds: 2,
					members: 3,
					devices: devices(ago(1), ago(4)),
					openAlerts: 2,
				}),
			],
			NOW,
			POLICY,
		);
		expect(row?.state).toBe("ok");
		expect(row?.reporting).toBe(2);
		expect(row?.lastHeartbeatAt?.toISOString()).toBe(ago(1).toISOString());
		expect(row?.ponds).toBe(2);
		expect(row?.members).toBe(3);
		expect(row?.openAlerts).toBe(2);
	});
});

describe("sortTenantHealthRows", () => {
	it("puts the worst first, then sorts by name", () => {
		const rows = buildTenantHealthRows(
			[
				tenant({ orgId: "ok", orgName: "Zeta", devices: devices(ago(1)) }),
				tenant({ orgId: "crit", orgName: "Beta", devices: devices(ago(60), ago(60)) }),
				tenant({ orgId: "unknown", orgName: "Alpha" }),
			],
			NOW,
			POLICY,
		);
		expect(rows.map((row) => row.orgName)).toEqual(["Beta", "Alpha", "Zeta"]);
	});

	it("is stable for equal states", () => {
		const rows = buildTenantHealthRows(
			[
				tenant({ orgId: "b", orgName: "Beta", devices: devices(ago(1)) }),
				tenant({ orgId: "a", orgName: "Alpha", devices: devices(ago(1)) }),
			],
			NOW,
			POLICY,
		);
		expect(sortTenantHealthRows(rows).map((row) => row.orgName)).toEqual(["Alpha", "Beta"]);
	});
});

describe("summarizeTenants", () => {
	it("is the worst tenant, never an average", () => {
		const rows = buildTenantHealthRows(
			[
				tenant({ orgId: "ok", devices: devices(ago(1)) }),
				tenant({ orgId: "crit", devices: devices(ago(60), ago(60)) }),
			],
			NOW,
			POLICY,
		);
		const summary = summarizeTenants(rows);
		expect(summary.state).toBe("critical");
		expect(summary.total).toBe(2);
		expect(summary.counts.critical).toBe(1);
		expect(summary.counts.ok).toBe(1);
	});

	it("is unknown with no tenants at all", () => {
		expect(summarizeTenants([]).state).toBe("unknown");
	});
});

describe("paginateTenantRows", () => {
	const rows = buildTenantHealthRows(
		[
			tenant({ orgId: "1", orgName: "Alpha", devices: devices(ago(1)) }),
			tenant({ orgId: "2", orgName: "Beta", devices: devices(ago(60), ago(60)) }),
			tenant({ orgId: "3", orgName: "Gamma", devices: devices(ago(30), ago(1), ago(1), ago(1)) }),
			tenant({ orgId: "4", orgName: "Delta" }),
			tenant({ orgId: "5", orgName: "Epsilon", devices: devices(ago(1), ago(1)) }),
		],
		NOW,
		POLICY,
	);

	it("pages the already-ranked rows, so page 1 holds the worst tenants", () => {
		const first = paginateTenantRows(rows, 1, 2);
		expect(first.rows.map((row) => row.state)).toEqual(["critical", "degraded"]);
		expect(first.pagination).toMatchObject({
			page: 1,
			pageSize: 2,
			total: 5,
			pageCount: 3,
			firstRow: 1,
			lastRow: 2,
		});
	});

	it("returns the tail on the last page", () => {
		const last = paginateTenantRows(rows, 3, 2);
		expect(last.rows).toHaveLength(1);
		expect(last.pagination.lastRow).toBe(5);
	});

	it("clamps a stale page instead of rendering an empty page", () => {
		const stale = paginateTenantRows(rows, 99, 2);
		expect(stale.pagination.page).toBe(3);
		expect(stale.rows).toHaveLength(1);
	});

	it("keeps an empty list on page 1", () => {
		const empty = paginateTenantRows([], 4, 10);
		expect(empty.pagination.page).toBe(1);
		expect(empty.pagination.total).toBe(0);
		expect(empty.rows).toEqual([]);
	});
});
