import { buildDayKeys } from "@/components/charts/chart-data";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { PH_TZ } from "@/lib/constants";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import {
	type AnalyticsRange,
	type AnalyticsWindow,
	DEFAULT_ANALYTICS_RANGE,
	resolveAnalyticsWindow,
} from "@/lib/platform/analytics";
import { resolveFarmsToOrganizations } from "@/lib/platform/tenant-resolution";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Feeding breakdowns for the platform console (epic #627, sections D and E).
 *
 * One range-bounded aggregate over `FeedEvent` supplies both splits: by
 * organization and by pond. The rows carry the immutable `farmId` stamp where it
 * exists and fall back to the pond owner for older rows, so a dispense is never
 * silently dropped from a tenant total. Farm → organization resolution is the
 * same read path the fleet monitor and incident queue use.
 *
 * Only machine dispenses count. An imported `hand_fed` row is a whole day of
 * hand feeding, not an operation, so it is excluded exactly as the overview's
 * `feedsPerDayBySource` excludes it.
 *
 * Operation count and consumed mass are separate fields. They answer different
 * questions and must never be collapsed into one series.
 */

interface FeedBreakdownQueryRow {
	farmId: string | null;
	pondId: string | null;
	pondName: string | null;
	operations: number;
	grams: number;
}

export interface FeedAmounts {
	operations: number;
	/** Total consumed mass in grams. */
	grams: number;
	/** The same mass in kilograms, rounded to two decimals for display. */
	kg: number;
}

export interface FeedBreakdownSlice extends FeedAmounts {
	/** Organization id, pond id, or `__unattributed__` / `__unassigned__`. */
	key: string;
	label: string;
	orgId: string | null;
	orgName: string | null;
	pondId: string | null;
	pondName: string | null;
}

export interface PlatformFeedBreakdown {
	range: AnalyticsRange;
	window: AnalyticsWindow;
	totals: FeedAmounts;
	/** Includes an explicit `Unattributed` slice when a row has no tenant. */
	byOrg: FeedBreakdownSlice[];
	/** Includes an explicit `Unassigned pond` slice when a device has no pond. */
	byPond: FeedBreakdownSlice[];
	/** Convenience copy of the `byOrg` slice with no tenant. */
	unattributed: FeedAmounts;
}

export interface FeedHeatmapCell {
	/** Local Asia/Manila day, `YYYY-MM-DD`. */
	day: string;
	/** Local hour, 0–23. */
	hour: number;
	operations: number;
	grams: number;
}

export interface PlatformFeedHeatmap {
	range: AnalyticsRange;
	window: AnalyticsWindow;
	/** Sparse: only (day, hour) pairs that had at least one dispense. */
	cells: FeedHeatmapCell[];
	/** The local days the range covers, oldest first. Fill missing cells with 0. */
	dayKeys: string[];
	/** Highest cell operation count, so a chart can scale without recomputing. */
	maxOperations: number;
}

const UNATTRIBUTED_KEY = "__unattributed__";
const UNASSIGNED_POND_KEY = "__unassigned__";

function roundKg(grams: number): number {
	return Math.round((grams / 1000) * 100) / 100;
}

function toAmounts(operations: number, grams: number): FeedAmounts {
	return { operations, grams: Math.round(grams * 100) / 100, kg: roundKg(grams) };
}

function emptyAmounts(): FeedAmounts {
	return { operations: 0, grams: 0, kg: 0 };
}

function addAmounts(target: FeedAmounts, source: FeedAmounts): void {
	target.operations += source.operations;
	target.grams += source.grams;
	target.kg = roundKg(target.grams);
}

function compareSlices(a: FeedBreakdownSlice, b: FeedBreakdownSlice): number {
	return b.grams - a.grams || a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}

function sliceFor(
	map: Map<string, FeedBreakdownSlice>,
	key: string,
	label: string,
	orgId: string | null,
	orgName: string | null,
	pondId: string | null,
	pondName: string | null,
): FeedBreakdownSlice {
	const existing = map.get(key);
	if (existing) return existing;
	const created: FeedBreakdownSlice = {
		key,
		label,
		orgId,
		orgName,
		pondId,
		pondName,
		...emptyAmounts(),
	};
	map.set(key, created);
	return created;
}

/**
 * Per-organization and per-pond consumption for one analytics window.
 *
 * Query count: one aggregate + the three bounded reads inside
 * `resolveFarmsToOrganizations` (users, memberships, organizations).
 * No per-row queries and no unbounded scan: `FeedEvent(eventType, receivedAt)`
 * carries the range predicate, and the result is grouped by farm and pond.
 */
export async function getFeedBreakdown(
	range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
	now = new Date(),
): Promise<PlatformFeedBreakdown> {
	await requirePlatformAdmin();

	const window = resolveAnalyticsWindow(range, now);
	const rows = await prisma.$queryRaw<FeedBreakdownQueryRow[]>`
		SELECT COALESCE(f."farmId", p."ownerId") AS "farmId",
		       d."pondId" AS "pondId",
		       p."name" AS "pondName",
		       COUNT(*)::int AS "operations",
		       COALESCE(SUM(f."grams"), 0)::float8 AS "grams"
		FROM "FeedEvent" f
		JOIN "EnergyDevice" d ON d."id" = f."deviceId"
		LEFT JOIN "Pond" p ON p."id" = d."pondId"
		WHERE f."eventType" = 'feed_dispensed'
		  AND f."source" IN (${Prisma.join([...MACHINE_FEED_SOURCES])})
		  AND f."receivedAt" >= ${window.start}
		  AND f."receivedAt" < ${window.end}
		GROUP BY 1, 2, 3
	`;

	const farmIds = [...new Set(rows.flatMap((row) => (row.farmId ? [row.farmId] : [])))];
	const tenants = await resolveFarmsToOrganizations(farmIds);

	const totals = emptyAmounts();
	const unattributed = emptyAmounts();
	const byOrg = new Map<string, FeedBreakdownSlice>();
	const byPond = new Map<string, FeedBreakdownSlice>();

	for (const row of rows) {
		const amounts = toAmounts(row.operations, Number(row.grams) || 0);
		addAmounts(totals, amounts);

		const tenant = row.farmId ? tenants.get(row.farmId) : undefined;
		if (!tenant) addAmounts(unattributed, amounts);

		const orgKey = tenant?.id ?? UNATTRIBUTED_KEY;
		const orgSlice = sliceFor(
			byOrg,
			orgKey,
			tenant?.name ?? "Unattributed",
			tenant?.id ?? null,
			tenant?.name ?? null,
			null,
			null,
		);
		addAmounts(orgSlice, amounts);

		const pondKey = row.pondId ?? UNASSIGNED_POND_KEY;
		const pondSlice = sliceFor(
			byPond,
			pondKey,
			row.pondName ?? "Unassigned pond",
			tenant?.id ?? null,
			tenant?.name ?? null,
			row.pondId,
			row.pondName,
		);
		addAmounts(pondSlice, amounts);
	}

	return {
		range,
		window,
		totals,
		byOrg: [...byOrg.values()].sort(compareSlices),
		byPond: [...byPond.values()].sort(compareSlices),
		unattributed,
	};
}

/**
 * Dispenses by local day and hour for one analytics window.
 *
 * Query count: one. `FeedEvent(eventType, receivedAt)` serves the range, and the
 * result is sparse by design — a day/hour with no dispense is absent, not zero.
 * The caller fills the grid from `dayKeys` and treats an absent cell as no
 * activity. `maxOperations` is the scale hint for the heatmap.
 */
export async function getFeedHeatmap(
	range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
	now = new Date(),
): Promise<PlatformFeedHeatmap> {
	await requirePlatformAdmin();

	const window = resolveAnalyticsWindow(range, now);
	const rows = await prisma.$queryRaw<FeedHeatmapCell[]>`
		SELECT to_char(
		           date_trunc('day', f."receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text),
		           'YYYY-MM-DD'
		       ) AS day,
		       EXTRACT(hour FROM f."receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${PH_TZ}::text)::int AS hour,
		       COUNT(*)::int AS operations,
		       COALESCE(SUM(f."grams"), 0)::float8 AS grams
		FROM "FeedEvent" f
		WHERE f."eventType" = 'feed_dispensed'
		  AND f."source" IN (${Prisma.join([...MACHINE_FEED_SOURCES])})
		  AND f."receivedAt" >= ${window.start}
		  AND f."receivedAt" < ${window.end}
		GROUP BY 1, 2
		ORDER BY 1, 2
	`;

	const cells = rows.map((row) => ({
		day: row.day,
		hour: Number(row.hour),
		operations: Number(row.operations) || 0,
		grams: Math.round(Number(row.grams) || 0),
	}));
	const maxOperations = cells.reduce((max, cell) => Math.max(max, cell.operations), 0);

	return {
		range,
		window,
		cells,
		dayKeys: buildDayKeys(window.start, window.end, PH_TZ).slice(-range),
		maxOperations,
	};
}
