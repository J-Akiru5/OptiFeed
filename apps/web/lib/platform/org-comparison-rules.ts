import { type BandState, worstState } from "@/lib/platform/status-band-rules";
import type { TenantHealthRow } from "@/lib/platform/tenant-health-rules";
import { sortTenantHealthRows } from "@/lib/platform/tenant-health-rules";

/**
 * Per-organization comparison rules (issue #479, M3C.9).
 *
 * The tenant table answers "which tenants are unhealthy". This answers the next
 * question: *between these tenants, who is actually worse, and by how much?* It
 * reads the same rows the tenant table reads and reuses the same instruments:
 *
 *  - the composed state is the row's own `state` (fleet worst org status), so a
 *    tenant is never better here than it is on the tenant table;
 *  - ordering is `BAND_STATE_ORDER` through `sortTenantHealthRows`, so the worst
 *    tenant is first on both pages;
 *  - a null value means "not measured", never zero. It is never the best value
 *    and never a tie, because an unmeasured number is not a good number.
 *
 * No composite score, no weighted index: "best" is only ever the best value of
 * one metric, and metrics with no defensible direction (how many ponds is not a
 * quality) carry no winner at all.
 */

export type ComparisonMetricKey =
	| "offlinePct"
	| "openAlerts"
	| "reporting"
	| "devices"
	| "ponds"
	| "members"
	| "lastHeartbeatAt";

export type ComparisonDirection = "lower" | "higher" | "none";

export interface ComparisonMetricDefinition {
	key: ComparisonMetricKey;
	/** Which end of the scale is better. `none` means the number is context only. */
	direction: ComparisonDirection;
}

export const COMPARISON_METRICS: readonly ComparisonMetricDefinition[] = [
	{ key: "offlinePct", direction: "lower" },
	{ key: "openAlerts", direction: "lower" },
	{ key: "reporting", direction: "none" },
	{ key: "devices", direction: "none" },
	{ key: "ponds", direction: "none" },
	{ key: "members", direction: "none" },
	{ key: "lastHeartbeatAt", direction: "higher" },
] as const;

/** Two organizations is the smallest number that can be compared. */
export const COMPARISON_MIN_ORGS = 2;
/** A side-by-side table stops being readable past four. */
export const COMPARISON_MAX_ORGS = 4;

export interface ComparisonSelection {
	/** Known organizations, in the order the operator asked for. */
	selected: string[];
	/** Requested ids that no longer exist; reported, never silently dropped. */
	droppedOrgIds: string[];
	/** True when the request named more organizations than the table can show. */
	truncated: boolean;
}

/**
 * Normalize `?org=` from the URL. Duplicates collapse, unknown ids are reported
 * separately (an id for a deleted tenant must not look like a selection of one),
 * and the list is capped. A short selection is not an error here — the page
 * decides what to render when fewer than `COMPARISON_MIN_ORGS` remain.
 */
export function parseComparisonSelection(
	raw: string | string[] | undefined,
	available: readonly string[],
): ComparisonSelection {
	const requested = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	const seen = new Set<string>();
	const unique: string[] = [];
	for (const id of requested) {
		if (seen.has(id)) continue;
		seen.add(id);
		unique.push(id);
	}

	const availableSet = new Set(available);
	const known = unique.filter((id) => availableSet.has(id));
	const droppedOrgIds = unique.filter((id) => !availableSet.has(id));
	const truncated = known.length > COMPARISON_MAX_ORGS;

	return {
		selected: truncated ? known.slice(0, COMPARISON_MAX_ORGS) : known,
		droppedOrgIds,
		truncated,
	};
}

export interface ComparisonMetricSummary {
	key: ComparisonMetricKey;
	direction: ComparisonDirection;
	/** Organizations with a measured value for this metric. */
	measured: number;
	/** Every organization tied at the best value; empty when there is no winner. */
	bestOrgIds: string[];
}

export interface OrgComparison {
	/** Selected rows, worst first. */
	rows: TenantHealthRow[];
	/** Selected ids that matched no organization. */
	missingOrgIds: string[];
	metrics: ComparisonMetricSummary[];
	/** Tenants in the selection whose state is unknown — not measured, not fine. */
	unknownOrgIds: string[];
	/** The worst state in the selection; `unknown` when nothing is selected. */
	state: BandState;
}

function metricValue(row: TenantHealthRow, key: ComparisonMetricKey): number | null {
	switch (key) {
		case "offlinePct":
			return row.offlinePct;
		case "openAlerts":
			return row.openAlerts;
		case "reporting":
			return row.reporting;
		case "devices":
			return row.devices;
		case "ponds":
			return row.ponds;
		case "members":
			return row.members;
		case "lastHeartbeatAt":
			return row.lastHeartbeatAt ? row.lastHeartbeatAt.getTime() : null;
	}
}

export function buildOrgComparison(
	rows: readonly TenantHealthRow[],
	selectedIds: readonly string[],
): OrgComparison {
	const byId = new Map(rows.map((row) => [row.orgId, row]));
	const selected: TenantHealthRow[] = [];
	const missingOrgIds: string[] = [];

	const seen = new Set<string>();
	for (const id of selectedIds) {
		if (seen.has(id)) continue;
		seen.add(id);
		const row = byId.get(id);
		if (row) selected.push(row);
		else missingOrgIds.push(id);
	}

	const ranked = sortTenantHealthRows(selected);

	const metrics: ComparisonMetricSummary[] = COMPARISON_METRICS.map((definition) => {
		const measuredValues = ranked.flatMap((row) => {
			const value = metricValue(row, definition.key);
			return value === null ? [] : [{ orgId: row.orgId, value }];
		});

		if (definition.direction === "none" || measuredValues.length === 0) {
			return {
				key: definition.key,
				direction: definition.direction,
				measured: measuredValues.length,
				bestOrgIds: [],
			};
		}

		const best =
			definition.direction === "lower"
				? Math.min(...measuredValues.map((entry) => entry.value))
				: Math.max(...measuredValues.map((entry) => entry.value));

		return {
			key: definition.key,
			direction: definition.direction,
			measured: measuredValues.length,
			bestOrgIds: measuredValues
				.filter((entry) => entry.value === best)
				.map((entry) => entry.orgId),
		};
	});

	return {
		rows: ranked,
		missingOrgIds,
		metrics,
		unknownOrgIds: ranked.filter((row) => row.state === "unknown").map((row) => row.orgId),
		state: ranked.length === 0 ? "unknown" : worstState(ranked.map((row) => row.state)),
	};
}

/** Renders a metric value for display; null stays "not reported", never zero. */
export function formatComparisonValue(
	row: TenantHealthRow,
	key: ComparisonMetricKey,
): number | Date | null {
	if (key === "lastHeartbeatAt") return row.lastHeartbeatAt;
	return metricValue(row, key);
}
