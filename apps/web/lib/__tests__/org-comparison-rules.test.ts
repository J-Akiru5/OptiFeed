import { describe, expect, it } from "vitest";
import { deviceStatusPolicyFromValue } from "../device-status";
import {
	COMPARISON_MAX_ORGS,
	type ComparisonMetricSummary,
	buildOrgComparison,
	formatComparisonValue,
	parseComparisonSelection,
} from "../platform/org-comparison-rules";
import type { TenantHealthRow } from "../platform/tenant-health-rules";
import { type TenantHealthInput, buildTenantHealthRows } from "../platform/tenant-health-rules";

/**
 * Organization comparison rules (issue #479, M3C.9).
 *
 * The comparison must not be a second opinion about a tenant's health: these
 * tests build rows through the tenant rules themselves, then assert that the
 * comparison only orders, marks and formats them.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

function tenant(overrides: Partial<TenantHealthInput> & { orgId: string }): TenantHealthInput {
	return {
		orgName: overrides.orgId.toUpperCase(),
		orgStatus: "ACTIVE",
		members: 1,
		ponds: 1,
		devices: [],
		openAlerts: 0,
		...overrides,
	};
}

function rows(inputs: TenantHealthInput[]): TenantHealthRow[] {
	return buildTenantHealthRows(inputs, NOW, POLICY);
}

/** Four tenants in the exact order the tenant table would rank them. */
function sampleRows(): TenantHealthRow[] {
	return rows([
		// ok: online, no alerts, recent heartbeat.
		tenant({
			orgId: "ok-org",
			orgName: "Ok Farm",
			devices: [
				{ id: "d1", lastSeenAt: ago(1) },
				{ id: "d2", lastSeenAt: ago(1) },
			],
			openAlerts: 2,
			ponds: 3,
			members: 4,
		}),
		// degraded: half the reporting units offline, one alert.
		tenant({
			orgId: "degraded-org",
			orgName: "Degraded Farm",
			devices: [
				{ id: "d3", lastSeenAt: ago(1) },
				{ id: "d4", lastSeenAt: ago(60) },
			],
			openAlerts: 1,
			ponds: 2,
			members: 2,
		}),
		// critical: three of four offline.
		tenant({
			orgId: "critical-org",
			orgName: "Critical Farm",
			devices: [
				{ id: "d5", lastSeenAt: ago(1) },
				{ id: "d6", lastSeenAt: ago(90) },
				{ id: "d7", lastSeenAt: ago(120) },
				{ id: "d8", lastSeenAt: ago(180) },
			],
			openAlerts: 7,
			ponds: 1,
			members: 1,
		}),
		// unknown: never reported.
		tenant({
			orgId: "unknown-org",
			orgName: "Unknown Farm",
			devices: [{ id: "d9", lastSeenAt: null }],
			openAlerts: 0,
			ponds: 0,
			members: 0,
		}),
	]);
}

function metric(metrics: ComparisonMetricSummary[], key: ComparisonMetricSummary["key"]) {
	const found = metrics.find((entry) => entry.key === key);
	if (!found) throw new Error(`missing metric ${key}`);
	return found;
}

describe("parseComparisonSelection", () => {
	const available = ["a", "b", "c", "d", "e", "f"];

	it("keeps the requested order, collapses duplicates and trims", () => {
		expect(parseComparisonSelection([" b ", "a", "b"], available)).toEqual({
			selected: ["b", "a"],
			droppedOrgIds: [],
			truncated: false,
		});
	});

	it("reports ids that match no organization instead of dropping them silently", () => {
		expect(parseComparisonSelection(["a", "gone"], available)).toEqual({
			selected: ["a"],
			droppedOrgIds: ["gone"],
			truncated: false,
		});
	});

	it("caps the table and says it did", () => {
		const parsed = parseComparisonSelection(["a", "b", "c", "d", "e"], available);
		expect(parsed.selected).toHaveLength(COMPARISON_MAX_ORGS);
		expect(parsed.selected).toEqual(["a", "b", "c", "d"]);
		expect(parsed.truncated).toBe(true);
	});

	it("treats a missing or blank selection as empty, not as an error", () => {
		expect(parseComparisonSelection(undefined, available).selected).toEqual([]);
		expect(parseComparisonSelection(["", "   "], available).selected).toEqual([]);
	});

	it("does not enforce the minimum: one id is a selection the page must explain", () => {
		expect(parseComparisonSelection("a", available).selected).toEqual(["a"]);
	});
});

describe("buildOrgComparison", () => {
	it("orders the selected tenants worst first, using the shared band order", () => {
		const comparison = buildOrgComparison(sampleRows(), [
			"ok-org",
			"unknown-org",
			"critical-org",
			"degraded-org",
		]);

		expect(comparison.rows.map((row) => row.orgId)).toEqual([
			"critical-org",
			"degraded-org",
			"unknown-org",
			"ok-org",
		]);
		expect(comparison.state).toBe("critical");
	});

	it("marks only the selected rows and reports ids it could not resolve", () => {
		const comparison = buildOrgComparison(sampleRows(), ["ok-org", "deleted-org"]);

		expect(comparison.rows.map((row) => row.orgId)).toEqual(["ok-org"]);
		expect(comparison.missingOrgIds).toEqual(["deleted-org"]);
	});

	it("never calls an unmeasured fleet healthy", () => {
		const comparison = buildOrgComparison(sampleRows(), ["unknown-org", "ok-org"]);
		const unknown = comparison.rows.find((row) => row.orgId === "unknown-org");

		expect(unknown?.state).toBe("unknown");
		expect(comparison.unknownOrgIds).toEqual(["unknown-org"]);
	});

	it("picks the lowest value when lower is better and the highest when higher is", () => {
		const comparison = buildOrgComparison(sampleRows(), ["ok-org", "degraded-org", "critical-org"]);

		expect(metric(comparison.metrics, "openAlerts").bestOrgIds).toEqual(["degraded-org"]);
		expect(metric(comparison.metrics, "offlinePct").bestOrgIds).toEqual(["ok-org"]);
		// Reporting units is fleet size, not health: it never carries a winner.
		expect(metric(comparison.metrics, "reporting").bestOrgIds).toEqual([]);
	});

	it("keeps every organization tied at the best value", () => {
		const tied = rows([
			tenant({
				orgId: "a",
				orgName: "A",
				devices: [{ id: "d1", lastSeenAt: ago(1) }],
				openAlerts: 3,
			}),
			tenant({
				orgId: "b",
				orgName: "B",
				devices: [{ id: "d2", lastSeenAt: ago(1) }],
				openAlerts: 3,
			}),
		]);

		const comparison = buildOrgComparison(tied, ["a", "b"]);

		expect(metric(comparison.metrics, "openAlerts").bestOrgIds).toEqual(["a", "b"]);
	});

	it("never lets a non-reported value be the best", () => {
		const mixed = rows([
			tenant({
				orgId: "reported",
				orgName: "Reported",
				devices: [{ id: "d1", lastSeenAt: ago(60) }],
				openAlerts: 4,
			}),
			tenant({
				orgId: "silent",
				orgName: "Silent",
				devices: [{ id: "d2", lastSeenAt: null }],
				openAlerts: 0,
			}),
		]);

		const comparison = buildOrgComparison(mixed, ["reported", "silent"]);
		const offline = metric(comparison.metrics, "offlinePct");

		expect(offline.measured).toBe(1);
		expect(offline.bestOrgIds).toEqual(["reported"]);
	});

	it("declares no winner for metrics with no better direction", () => {
		const comparison = buildOrgComparison(sampleRows(), ["ok-org", "critical-org"]);

		for (const key of ["devices", "ponds", "members", "reporting"] as const) {
			expect(metric(comparison.metrics, key).bestOrgIds).toEqual([]);
		}
	});

	it("reports no winner at all when nothing was measured", () => {
		const silent = rows([tenant({ orgId: "silent", devices: [{ id: "d", lastSeenAt: null }] })]);

		const comparison = buildOrgComparison(silent, ["silent", "silent"]);

		expect(comparison.rows).toHaveLength(1);
		expect(metric(comparison.metrics, "offlinePct")).toMatchObject({ measured: 0, bestOrgIds: [] });
		expect(metric(comparison.metrics, "lastHeartbeatAt")).toMatchObject({
			measured: 0,
			bestOrgIds: [],
		});
	});

	it("is unknown, not ok, when nothing is selected", () => {
		const comparison = buildOrgComparison(sampleRows(), []);

		expect(comparison.rows).toEqual([]);
		expect(comparison.state).toBe("unknown");
		expect(comparison.unknownOrgIds).toEqual([]);
	});
});

describe("formatComparisonValue", () => {
	it("keeps an unreported number null and hands dates through untouched", () => {
		const [unknownRow, criticalRow] = [
			rows([tenant({ orgId: "u", devices: [{ id: "d", lastSeenAt: null }] })])[0],
			rows([tenant({ orgId: "c", devices: [{ id: "d", lastSeenAt: ago(1) }], openAlerts: 5 })])[0],
		];

		expect(formatComparisonValue(unknownRow, "offlinePct")).toBeNull();
		expect(formatComparisonValue(unknownRow, "reporting")).toBe(0);
		expect(formatComparisonValue(criticalRow, "openAlerts")).toBe(5);
		expect(formatComparisonValue(criticalRow, "lastHeartbeatAt")).toBeInstanceOf(Date);
	});
});
