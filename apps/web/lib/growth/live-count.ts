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
 * Never negative: excess logs clamp to zero.
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
export function deriveLiveCount(stocked: number | null, mortalityTotal: number): LiveCount {
	const dead = Math.max(0, Math.floor(mortalityTotal));
	if (stocked === null) {
		return { stocked: null, dead, live: null, source: "none" };
	}
	const live = Math.max(0, stocked - dead);
	return {
		stocked,
		dead,
		live,
		source: "crop_cycle" as const,
	};
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
	const [cycle, logs] = await Promise.all([
		prisma.cropCycle.findFirst({
			where: { pondId, status: "ACTIVE" },
			select: { stockingCount: true, stockingDate: true },
		}),
		prisma.mortalityLog.aggregate({
			where: { pondId },
			_count: { count: true },
			_sum: { count: true },
		}),
	]);

	const stocked = cycle ? cycle.stockingCount : (pond_?.population ?? null);
	const source: LiveCount["source"] = cycle
		? "crop_cycle"
		: stocked !== null
			? "legacy_population"
			: "none";
	const dead = Math.max(0, Math.floor(logs._sum.count ?? 0));
	const live = stocked === null ? null : Math.max(0, stocked - dead);
	return { stocked, dead, live, source };
}
