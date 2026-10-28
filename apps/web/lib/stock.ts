import { DEFAULT_FISH_COUNT } from "@/lib/constants";

/**
 * Live fish count, the only population a feeding or growth calculation may use.
 *
 * The team's data sheet ("Catfish Feed Calculation Data Collection Sheet")
 * states the rule explicitly:
 *
 *   Daily feed (kg) = ABW (kg) × live fish × feeding rate (%)
 *
 * with live fish = stocked − mortality (300 stocked → 285 live). Using the
 * stocked figure overstates every feed figure by the mortality share, so every
 * calculation must resolve the count through this module instead of reading
 * `Pond.population` or `CropCycle.stockingCount` directly.
 *
 * There is no mortality table in the schema. The app's live-count source is
 * therefore `Pond.population` (the farmer's current count). When it is missing,
 * the best available estimate is the stocked count times the cycle's expected
 * survival. Both are labelled so a caller can surface the assumption.
 */
export type LiveFishCountSource = "pond" | "stocking-estimate" | "default";

export interface LiveFishCount {
	count: number;
	source: LiveFishCountSource;
}

export interface LiveFishCountInput {
	/** `Pond.population` — the current number of fish in the water. */
	population?: number | null;
	/** `CropCycle.stockingCount` — fish put in at stocking. */
	stockingCount?: number | null;
	/** `CropCycle.expectedSurvivalPct` — only used to estimate from stocking. */
	expectedSurvivalPct?: number | null;
	/** Last resort when neither source is known; omit to get null. */
	fallbackCount?: number | null;
}

function positiveCount(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return Math.max(1, Math.round(value));
}

function survivalFraction(value: number | null | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1;
	return Math.min(100, Math.max(1, value)) / 100;
}

/**
 * Resolve the live fish count in priority order:
 *
 * 1. `Pond.population` (measured/current count) — used as-is;
 * 2. stocked count × expected survival (an estimate, labelled as such);
 * 3. an explicit fallback, or `null` when nothing is known.
 *
 * A value of 0, a negative number, NaN or Infinity is never trusted.
 */
export function resolveLiveFishCount(input: LiveFishCountInput): LiveFishCount | null {
	const population = positiveCount(input.population);
	if (population !== null) return { count: population, source: "pond" };

	const stockingCount = positiveCount(input.stockingCount);
	if (stockingCount !== null) {
		const estimate = Math.max(
			1,
			Math.round(stockingCount * survivalFraction(input.expectedSurvivalPct)),
		);
		return { count: estimate, source: "stocking-estimate" };
	}

	const fallback = positiveCount(input.fallbackCount);
	return fallback === null ? null : { count: fallback, source: "default" };
}

/** Convenience for callers that only need the number, or null when unknown. */
export function liveFishCount(input: LiveFishCountInput): number | null {
	return resolveLiveFishCount(input)?.count ?? null;
}

/**
 * Live count with the app-wide default as the last resort. Use only where a
 * missing population already produces a visible "estimate" label; a silent
 * 5,000-fish default inflates feed and biomass figures.
 */
export function liveFishCountOrDefault(input: Omit<LiveFishCountInput, "fallbackCount">): {
	count: number;
	source: LiveFishCountSource;
} {
	return (
		resolveLiveFishCount({ ...input, fallbackCount: DEFAULT_FISH_COUNT }) ?? {
			count: DEFAULT_FISH_COUNT,
			source: "default",
		}
	);
}
