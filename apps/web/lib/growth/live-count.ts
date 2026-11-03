import { dateOnlyToUtcDate } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";

/**
 * Live fish count derived from mortality (issue #452).
 *
 * Decision (recorded in the issue, E59): the live count is *derived at read
 * time* — never stored back. `Pond.population` keeps working exactly as before
 * (the hand-typed count) and remains the dose-path fallback; this helper only
 * changes what pages *display*.
 *
 * Stock source precedence:
 *  1. the pond's ACTIVE crop cycle `stockingCount` (authoritative stocking data);
 *  2. `Pond.population` (legacy hand-typed count, keeps old ponds working).
 *
 * Live = stock − Σ mortality logs recorded on/after the stocking date (one
 * row when no active cycle exists, so legacy ponds still subtract their log).
 * New writes are bounded by `mortalityFitsLive` (#764); the clamp at zero stays
 * as a read-time safety net for rows written before that guard existed.
 */

export interface LiveCount {
	/** Stock the live count is derived from (stocking count or legacy population). */
	stocked: number | null;
	/** Sum of mortality recorded against the current cycle. */
	dead: number;
	/** stocked − dead clamped at zero; null when no stock source exists. */
	live: number | null;
	/** Which stock source produced `stocked`. */
	source: "crop_cycle" | "legacy_population" | "none";
}

/**
 * Pure calculation, exported for unit tests. `stocked` may be null (no stock
 * source) in which case the live count is also null — a mortality log without
 * a known stock cannot invent a count.
 */
export function deriveLiveCount(
	stocked: number | null,
	mortalityTotal: number,
	source: LiveCount["source"] = "crop_cycle",
): LiveCount {
	const dead = Math.max(0, Math.floor(mortalityTotal));
	if (stocked === null) {
		return { stocked: null, dead, live: null, source: "none" };
	}
	const live = Math.max(0, stocked - dead);
	return { stocked, dead, live, source };
}

/**
 * Whether one more mortality entry fits inside the stock that is still alive.
 *
 * The write path refuses a count that would exceed the live population (#764).
 * `deriveLiveCount` still clamps at zero for legacy/corrupt rows, but that clamp
 * must not be the only guard: silently accepting 500 dead out of 300 stocked
 * turns a data-entry mistake into a permanent record.
 *
 * A pond with no stock source cannot be bounded; the caller keeps the legacy
 * behaviour and records what the farmer saw.
 */
export function mortalityFitsLive(
	stocked: number | null,
	alreadyDead: number,
	requested: number,
): boolean {
	if (stocked === null) return true;
	const dead = Math.max(0, Math.floor(alreadyDead));
	const count = Math.max(0, Math.floor(requested));
	return dead + count <= Math.max(0, stocked);
}

/**
 * Mortality as a percentage of the stocked count, clamped to 0–100. Null when
 * there is no stock source, so the UI can say "not set" instead of inventing a
 * rate.
 */
export function mortalityRatePct(dead: number, stocked: number | null): number | null {
	if (stocked === null || stocked <= 0) return null;
	const pct = (Math.max(0, dead) / stocked) * 100;
	return Math.min(100, Math.max(0, pct));
}

export interface CycleLiveWindow {
	cycleId: string;
	pondId: string;
	stockingCount: number;
	/** Farm calendar date (`YYYY-MM-DD`) the cycle was stocked. */
	stockingDate: string;
}

/**
 * Live counts for a set of ACTIVE cycles, keyed by cycle id.
 *
 * The harvest form needs the live count for whichever pond the farmer selects
 * (#764). One read supplies every active cycle; per-cycle windows still use the
 * stocking date, so an older cycle's deaths never reduce a newer cycle.
 */
export async function getLiveCountsForCycles(
	cycles: readonly CycleLiveWindow[],
): Promise<Map<string, number>> {
	const liveByCycle = new Map<string, number>();
	if (cycles.length === 0) return liveByCycle;

	const earliestStocking = cycles.reduce(
		(min, cycle) => (cycle.stockingDate < min ? cycle.stockingDate : min),
		cycles[0].stockingDate,
	);
	const rows = await prisma.mortalityLog.findMany({
		where: {
			pondId: { in: [...new Set(cycles.map((cycle) => cycle.pondId))] },
			recordedAt: { gte: dateOnlyToUtcDate(earliestStocking) },
		},
		select: { pondId: true, count: true, recordedAt: true },
	});

	for (const cycle of cycles) {
		const stockedFrom = dateOnlyToUtcDate(cycle.stockingDate);
		const dead = rows
			.filter((row) => row.pondId === cycle.pondId && row.recordedAt >= stockedFrom)
			.reduce((sum, row) => sum + row.count, 0);
		liveByCycle.set(cycle.cycleId, Math.max(0, cycle.stockingCount - dead));
	}
	return liveByCycle;
}

/**
 * Live count for one pond, derived at read time. Also tolerates read paths
 * that already hold the pond row (avoids a second query in page components):
 * pass `pond` when you have it.
 */
export async function getLiveCountForPond(
	pondId: string,
	pond?: { population: number | null } | null,
): Promise<LiveCount> {
	const pond_ =
		pond ?? (await prisma.pond.findUnique({ where: { id: pondId }, select: { population: true } }));
	// The stocking date bounds the mortality that belongs to *this* cycle.
	// Without it a second cycle inherits the first cycle's deaths (#430).
	const cycle = await prisma.cropCycle.findFirst({
		where: { pondId, status: "ACTIVE" },
		select: { stockingCount: true, stockingDate: true },
	});

	const logs = await prisma.mortalityLog.aggregate({
		where: cycle ? { pondId, recordedAt: { gte: cycle.stockingDate } } : { pondId },
		_sum: { count: true },
	});

	const stocked = cycle ? cycle.stockingCount : (pond_?.population ?? null);
	const source: LiveCount["source"] = cycle
		? "crop_cycle"
		: stocked !== null
			? "legacy_population"
			: "none";
	return deriveLiveCount(stocked, logs._sum.count ?? 0, source);
}
