/**
 * How many fish are actually in the pond — the population every feed figure
 * must use.
 *
 * The calculation-audit reference sheet (2026-10-28) is explicit:
 *
 *   Daily feed = ABW × **live fish** × feeding rate
 *   live fish  = stocked − mortality            (300 → 285 in the sheet)
 *
 * The app historically fed from `Pond.population`, which is the **stocked**
 * count written when a cycle starts and never reduced. That over-feeds by the
 * mortality rate: the Demo Pond showed 2,110.05 g/day while the sheet's live
 * count gives 2,004.55 g. The growth plan already applied the cycle's survival
 * rate; every other feed figure did not. This module is now the only place
 * that decides the count.
 *
 * Sources, strongest first:
 *
 * 1. `mortalityCount` — an observed loss count. The schema has no mortality
 *    log yet (see the audit ledger: needs Jeff/Karl), so no caller in the app
 *    passes one today; the branch exists so adding that input later changes
 *    one call site, not every formula.
 * 2. `expectedSurvivalPct` — the grow-out cycle's recorded survival
 *    assumption (the same value `lib/growth-plan.ts` already multiplies by).
 * 3. The stocked count, unchanged, when neither exists.
 *
 * A missing count stays `null`: no feed figure may invent a population.
 * `DEFAULT_FISH_COUNT` is a demo seed value (5,000), not a pond fact.
 *
 * Pure by design (no Prisma, no React) so client components and tests can use
 * it. The database resolver is `lib/population-server.ts`.
 */

export type PopulationSource = "mortality" | "survival" | "stocked" | "unknown";

export interface PopulationInput {
	/** Fish put in the pond (active cycle's stocking count, else Pond.population). */
	stockedCount?: number | null;
	/** Observed dead/lost fish. Wins over the survival estimate when supplied. */
	mortalityCount?: number | null;
	/** Planned survival for the cycle, percent (0–100]. */
	expectedSurvivalPct?: number | null;
}

export interface LiveFishCount {
	/** Fish presumed alive. `null` when nothing is recorded — never a guess. */
	liveFish: number | null;
	/** The stocked count this was derived from, when known. */
	stockedCount: number | null;
	source: PopulationSource;
	/** Survival percentage actually applied (null when none was). */
	survivalPct: number | null;
}

function positiveInteger(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return Math.round(value);
}

function validPercent(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
		return null;
	}
	return value;
}

/**
 * Pure live-fish resolution, so the formula can be unit tested against the
 * reference sheet without a database.
 */
export function resolveLiveFish(input: PopulationInput): LiveFishCount {
	const stockedCount = positiveInteger(input.stockedCount);
	if (stockedCount === null) {
		return { liveFish: null, stockedCount: null, source: "unknown", survivalPct: null };
	}

	// An observed loss count is a census, not an assumption. A total-loss report
	// resolves to 0 live fish, which every feed formula then treats as "nothing
	// to feed" instead of dividing by a positive number.
	const mortality =
		typeof input.mortalityCount === "number" && Number.isFinite(input.mortalityCount)
			? Math.round(input.mortalityCount)
			: null;
	if (mortality !== null && mortality >= 0) {
		return {
			liveFish: Math.max(0, stockedCount - mortality),
			stockedCount,
			source: "mortality",
			survivalPct: null,
		};
	}

	// Planned survival for the cycle. 100% means "no adjustment" — reporting it
	// as a survival-derived count would imply a measurement that does not exist.
	const survivalPct = validPercent(input.expectedSurvivalPct);
	if (survivalPct !== null && survivalPct < 100) {
		return {
			liveFish: Math.max(1, Math.round((stockedCount * survivalPct) / 100)),
			stockedCount,
			source: "survival",
			survivalPct,
		};
	}

	return { liveFish: stockedCount, stockedCount, source: "stocked", survivalPct };
}
