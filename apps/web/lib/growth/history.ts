import { daysBetween, isValidDateOnly } from "@/lib/crop-cycle/dates";
import { type GrowthDefaultField, isValidGrowthDefaultValue } from "./defaults";

/**
 * History-based growth suggestions (#826 part 2 / #828).
 *
 * Owner decision (2026-11-04): stored actuals are **evidence, not automation**.
 * A completed cycle's real outcome produces a suggestion for the next cycle,
 * the dialog shows it with its sample and range, and nothing is applied until
 * the operator presses Use.
 *
 * One pure module mirrors the resolution rules in `defaults.ts`, so the
 * suggestion cannot be out of range or invented:
 *
 *  - survival  = actualHarvestCount / stockingCount × 100, only when > 0 and ≤ 100;
 *  - target    = actualHarvestWeightKg × 1000 / actualHarvestCount;
 *  - grow-out  = actualHarvestDate − stockingDate, inside the global 30–365 rails.
 *
 * Cycles missing an actual are skipped for that field. When no completed cycle
 * supplies a field there is no suggestion for it — the dialog falls back to the
 * farm/system default and never invents a number.
 */

export const GROWTH_HISTORY_FIELDS = [
	"growOutDays",
	"targetHarvestWeightG",
	"expectedSurvivalPct",
] as const;

export type GrowthHistoryField = (typeof GROWTH_HISTORY_FIELDS)[number];

/** A completed cycle, already reduced to the values the suggestion needs. */
export interface CompletedCycleForSuggestion {
	id: string;
	label: string | null;
	pondName: string;
	/** Date-only `YYYY-MM-DD`. */
	stockingDate: string;
	stockingCount: number;
	/** Date-only `YYYY-MM-DD`, or null when the cycle is not harvested. */
	actualHarvestDate: string | null;
	actualHarvestWeightKg: number | null;
	actualHarvestCount: number | null;
}

export interface GrowthHistorySuggestion {
	field: GrowthHistoryField;
	/** The newest valid outcome for the field. */
	value: number;
	/** How many completed cycles supplied a valid value for the field. */
	sampleSize: number;
	min: number;
	max: number;
	/** The cycle the suggested value came from. */
	sourceCycleId: string;
	sourceLabel: string | null;
	sourcePondName: string;
	/** Date-only harvest date of the source cycle. */
	sourceHarvestDate: string;
}

interface DerivedSample {
	cycle: CompletedCycleForSuggestion;
	growOutDays: number | null;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
}

/** One decimal is the precision the dialog and the saved values display. */
function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function validField(field: GrowthDefaultField, value: number | null): value is number {
	return value !== null && isValidGrowthDefaultValue(field, value);
}

/**
 * Derive the three outcomes from one completed cycle. Any missing or
 * impossible value is `null` for that field, never zero and never a guess.
 */
export function deriveGrowthHistorySample(cycle: CompletedCycleForSuggestion): DerivedSample {
	const count = cycle.actualHarvestCount;
	const harvestDate = cycle.actualHarvestDate;

	let growOutDays: number | null = null;
	if (
		harvestDate !== null &&
		isValidDateOnly(cycle.stockingDate) &&
		isValidDateOnly(harvestDate) &&
		daysBetween(cycle.stockingDate, harvestDate) > 0
	) {
		const days = daysBetween(cycle.stockingDate, harvestDate);
		growOutDays = validField("growOutDays", days) ? days : null;
	}

	let expectedSurvivalPct: number | null = null;
	if (
		count !== null &&
		Number.isInteger(count) &&
		count > 0 &&
		Number.isInteger(cycle.stockingCount) &&
		cycle.stockingCount > 0
	) {
		const pct = round1((count / cycle.stockingCount) * 100);
		// A harvest count above the stocked count is a data-entry error, not a
		// survival above 100 %; do not suggest an impossible rate.
		expectedSurvivalPct = validField("expectedSurvivalPct", pct) ? pct : null;
	}

	let targetHarvestWeightG: number | null = null;
	if (
		count !== null &&
		Number.isInteger(count) &&
		count > 0 &&
		cycle.actualHarvestWeightKg !== null &&
		Number.isFinite(cycle.actualHarvestWeightKg) &&
		cycle.actualHarvestWeightKg > 0
	) {
		const grams = round1((cycle.actualHarvestWeightKg * 1000) / count);
		targetHarvestWeightG = validField("targetHarvestWeightG", grams) ? grams : null;
	}

	return { cycle, growOutDays, targetHarvestWeightG, expectedSurvivalPct };
}

function suggestionFor(
	samples: DerivedSample[],
	field: GrowthHistoryField,
): GrowthHistorySuggestion | null {
	const values = samples
		.map((sample) => ({ sample, value: sample[field] }))
		.filter((entry): entry is { sample: DerivedSample; value: number } => entry.value !== null);
	if (values.length === 0) return null;

	// Newest first: the caller orders by actual harvest date descending. The
	// suggested value is the most recent outcome; the range is every outcome in
	// the farm's history.
	const [newest] = values;
	const numbers = values.map((entry) => entry.value);

	return {
		field,
		value: newest.value,
		sampleSize: values.length,
		min: Math.min(...numbers),
		max: Math.max(...numbers),
		sourceCycleId: newest.sample.cycle.id,
		sourceLabel: newest.sample.cycle.label,
		sourcePondName: newest.sample.cycle.pondName,
		sourceHarvestDate: newest.sample.cycle.actualHarvestDate ?? "",
	};
}

/**
 * Build one suggestion per field from a farm's completed cycles.
 *
 * `cycles` must be newest-first (the loader orders by `actualHarvestDate`
 * desc). Cycles without any usable outcome are ignored entirely; an empty or
 * absent history returns an empty array, which is how the dialog knows to show
 * no suggestion at all.
 */
export function buildGrowthHistorySuggestions(
	cycles: readonly CompletedCycleForSuggestion[],
): GrowthHistorySuggestion[] {
	if (cycles.length === 0) return [];

	const seen = new Set<string>();
	const samples = cycles
		.filter((cycle) => {
			if (seen.has(cycle.id)) return false;
			seen.add(cycle.id);
			return (
				cycle.actualHarvestDate !== null &&
				cycle.actualHarvestDate.length > 0 &&
				cycle.stockingCount > 0 &&
				isValidDateOnly(cycle.stockingDate) &&
				isValidDateOnly(cycle.actualHarvestDate)
			);
		})
		.map(deriveGrowthHistorySample);

	return GROWTH_HISTORY_FIELDS.map((field) => suggestionFor(samples, field)).filter(
		(suggestion): suggestion is GrowthHistorySuggestion => suggestion !== null,
	);
}

/** Human-facing units, shared by the dialog and its tests. */
export function formatGrowthHistoryValue(field: GrowthHistoryField, value: number): string {
	switch (field) {
		case "growOutDays":
			return `${value} d`;
		case "expectedSurvivalPct":
			return `${value} %`;
		default:
			return `${value} g`;
	}
}
