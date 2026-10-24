import { MAX_FEED_GRAMS_PER_REQUEST } from "@/lib/limits";

/**
 * The plan is deliberately transparent: a straight line from the stocking
 * weight to the target weight. It is a target, not a biological guarantee, so
 * every output carries the assumptions used to produce it.
 */
export const MAX_ADJUSTMENT_PCT = 0.1;
export const ADJUSTMENT_INTERVAL_DAYS = 15;
export const DENSITY_ADVISORY_PER_M2 = 20;
export const DEFAULT_TARGET_FCR = 1.5;
const MIN_FCR = 0.8;
const MAX_FCR = 2.5;
const TRACK_TOLERANCE_PCT = 3;
const TRAJECTORY_STEP_DAYS = 7;

/**
 * Date-only helpers kept local so this module stays dependency-free and can be
 * unit-tested without the Temporal polyfill. They never apply a timezone.
 */
function parseDateOnlyMs(value: string): number {
	const [year, month, day] = value.split("-").map(Number);
	return Date.UTC(year, month - 1, day);
}

function isValidDateOnly(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(parseDateOnlyMs(value));
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
	return Math.round((parseDateOnlyMs(to) - parseDateOnlyMs(from)) / 86_400_000);
}

function addDays(value: string, days: number): string {
	return new Date(parseDateOnlyMs(value) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface GrowthPlanCycle {
	id: string;
	label: string | null;
	stockingDate: string;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	growOutDays: number;
	targetHarvestDate: string;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
}

export interface GrowthPlanSample {
	id: string;
	date: string;
	avgWeightG: number;
	sampleCount: number;
}

export interface GrowthPlanPond {
	areaM2: number | null;
	averageDepthM: number | null;
	feedPricePerKg: number | null;
}

export interface GrowthPlanInput {
	cycle: GrowthPlanCycle | null;
	latestSample: GrowthPlanSample | null;
	previousSample: GrowthPlanSample | null;
	population: number;
	feedingRatePct: number;
	feedsPerDay: number;
	currentGramsPerFeeding: number | null;
	deviceMaxGramsPerFeeding?: number | null;
	/** Whether a feeder is linked at all (0g current is still a linked device). */
	hasDevice?: boolean;
	latestFcr: number | null;
	lastAdjustmentAt: string | null;
	today: string;
	pond: GrowthPlanPond;
	currency?: string;
}

export type GrowthPlanStatus = "noCycle" | "noTarget" | "noWeight" | "ok" | "overdue";
export type GrowthPlanTrack = "ahead" | "onTrack" | "behind" | "unknown";
export type GrowthPlanAdjustmentBlock =
	| "none"
	| "noSample"
	| "adjustmentWindow"
	| "deviceCap"
	| "noDevice"
	| "noTarget";

export interface GrowthPlanTrajectoryPoint {
	date: string;
	targetWeightG: number;
}

export interface GrowthPlan {
	status: GrowthPlanStatus;
	cycleId: string | null;
	label: string | null;
	today: string;
	targetDate: string | null;
	targetWeightG: number | null;
	daysToHarvest: number | null;
	growOutDay: number | null;
	progressPct: number | null;
	currentWeightG: number | null;
	currentSampleDate: string | null;
	sampleAgeDays: number | null;
	expectedWeightG: number | null;
	projectedHarvestWeightG: number | null;
	track: GrowthPlanTrack;
	trackDeltaG: number | null;
	trackDeltaPct: number | null;
	trajectory: GrowthPlanTrajectoryPoint[];
	requiredDailyGainG: number | null;
	requiredDailyFeedKg: number | null;
	requiredFeedingRatePct: number | null;
	recommendedGramsPerFeeding: number | null;
	applicableGramsPerFeeding: number | null;
	currentGramsPerFeeding: number | null;
	adjustmentPct: number | null;
	adjustmentAllowed: boolean;
	adjustmentBlock: GrowthPlanAdjustmentBlock;
	nextAdjustmentDate: string | null;
	maxChangePct: number;
	device: {
		maxGramsPerFeeding: number;
		requiredGramsPerFeeding: number | null;
		feasible: boolean;
		deficitGrams: number | null;
		extraMealsNeeded: number | null;
	};
	density: {
		areaM2: number | null;
		averageDepthM: number | null;
		fishPerM2: number | null;
		fishPerM3: number | null;
		advisory: "unknown" | "ok" | "high";
	};
	feed: {
		remainingFeedKg: number | null;
		totalCycleFeedKg: number | null;
		estimatedRemainingCost: number | null;
		estimatedCostPerFish: number | null;
		currency: string;
		fcrAssumption: number;
	};
	confidence: "low" | "medium" | "high";
	confidenceReasons: string[];
	notes: string[];
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function round1(value: number): number {
	return Math.round((value + 1e-9) * 10) / 10;
}

function round2(value: number): number {
	return Math.round((value + 1e-9) * 100) / 100;
}

function positive(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function emptyPlan(input: GrowthPlanInput): GrowthPlan {
	return {
		status: "noCycle",
		cycleId: null,
		label: null,
		today: input.today,
		targetDate: null,
		targetWeightG: null,
		daysToHarvest: null,
		growOutDay: null,
		progressPct: null,
		currentWeightG: null,
		currentSampleDate: null,
		sampleAgeDays: null,
		expectedWeightG: null,
		projectedHarvestWeightG: null,
		track: "unknown",
		trackDeltaG: null,
		trackDeltaPct: null,
		trajectory: [],
		requiredDailyGainG: null,
		requiredDailyFeedKg: null,
		requiredFeedingRatePct: null,
		recommendedGramsPerFeeding: null,
		applicableGramsPerFeeding: null,
		currentGramsPerFeeding: input.currentGramsPerFeeding,
		adjustmentPct: null,
		adjustmentAllowed: false,
		adjustmentBlock: "noTarget",
		nextAdjustmentDate: null,
		maxChangePct: MAX_ADJUSTMENT_PCT,
		device: {
			maxGramsPerFeeding: positive(input.deviceMaxGramsPerFeeding) ?? MAX_FEED_GRAMS_PER_REQUEST,
			requiredGramsPerFeeding: null,
			feasible: true,
			deficitGrams: null,
			extraMealsNeeded: null,
		},
		density: {
			areaM2: positive(input.pond.areaM2),
			averageDepthM: positive(input.pond.averageDepthM),
			fishPerM2: null,
			fishPerM3: null,
			advisory: "unknown",
		},
		feed: {
			remainingFeedKg: null,
			totalCycleFeedKg: null,
			estimatedRemainingCost: null,
			estimatedCostPerFish: null,
			currency: input.currency ?? "PHP",
			fcrAssumption: DEFAULT_TARGET_FCR,
		},
		confidence: "low",
		confidenceReasons: ["noCycle"],
		notes: [],
	};
}

function buildTrajectory(
	today: string,
	targetDate: string,
	currentWeightG: number,
	targetWeightG: number,
): GrowthPlanTrajectoryPoint[] {
	const daysToHarvest = daysBetween(today, targetDate);
	if (daysToHarvest <= 0) {
		return [{ date: today, targetWeightG: round1(currentWeightG) }];
	}

	const steps = Math.max(1, Math.ceil(daysToHarvest / TRAJECTORY_STEP_DAYS));
	return Array.from({ length: steps + 1 }, (_, index) => {
		const fraction = index / steps;
		return {
			date: addDays(today, Math.round(daysToHarvest * fraction)),
			targetWeightG: round1(currentWeightG + (targetWeightG - currentWeightG) * fraction),
		};
	});
}

/**
 * Build a target-weight plan from the active cycle, the latest sample and the
 * current device configuration. Pure so the UI, server action and tests share
 * exactly the same maths.
 */
export function buildGrowthPlan(input: GrowthPlanInput): GrowthPlan {
	const plan = emptyPlan(input);
	const cycle = input.cycle;

	if (!cycle || !isValidDateOnly(cycle.stockingDate) || !isValidDateOnly(cycle.targetHarvestDate)) {
		return plan;
	}

	const targetWeightG = positive(cycle.targetHarvestWeightG);
	const population = Math.max(1, Math.round(positive(input.population) ?? cycle.stockingCount));
	const survivalPct = clamp(cycle.expectedSurvivalPct ?? 100, 1, 100) / 100;
	const daysToHarvest = daysBetween(input.today, cycle.targetHarvestDate);
	const growOutDays = Math.max(1, cycle.growOutDays);
	const elapsedDays = clamp(daysBetween(cycle.stockingDate, input.today), 0, growOutDays);
	const growOutDay = clamp(elapsedDays + 1, 1, growOutDays);
	const progressPct = clamp((elapsedDays / growOutDays) * 100, 0, 100);

	plan.cycleId = cycle.id;
	plan.label = cycle.label;
	plan.targetDate = cycle.targetHarvestDate;
	plan.targetWeightG = targetWeightG;
	plan.daysToHarvest = daysToHarvest;
	plan.growOutDay = growOutDay;
	plan.progressPct = round1(progressPct);

	const currentWeightG =
		positive(input.latestSample?.avgWeightG) ?? positive(cycle.stockingAvgWeightG);
	plan.currentWeightG = currentWeightG;
	plan.currentSampleDate = input.latestSample?.date ?? null;
	plan.sampleAgeDays = input.latestSample
		? Math.max(0, daysBetween(input.latestSample.date, input.today))
		: null;

	const areaM2 = positive(input.pond.areaM2);
	const averageDepthM = positive(input.pond.averageDepthM);
	const fishPerM2 = areaM2 ? cycle.stockingCount / areaM2 : null;
	const fishPerM3 = areaM2 && averageDepthM ? cycle.stockingCount / (areaM2 * averageDepthM) : null;
	plan.density = {
		areaM2,
		averageDepthM,
		fishPerM2: fishPerM2 === null ? null : round1(fishPerM2),
		fishPerM3: fishPerM3 === null ? null : round1(fishPerM3),
		advisory: fishPerM2 === null ? "unknown" : fishPerM2 > DENSITY_ADVISORY_PER_M2 ? "high" : "ok",
	};

	if (targetWeightG === null) {
		plan.status = "noTarget";
		plan.adjustmentBlock = "noTarget";
		plan.confidenceReasons = ["noTarget"];
		return plan;
	}

	if (currentWeightG === null) {
		plan.status = "noWeight";
		plan.adjustmentBlock = "noSample";
		plan.confidenceReasons = ["noSample"];
		return plan;
	}

	plan.status = daysToHarvest < 0 ? "overdue" : "ok";
	plan.trajectory = buildTrajectory(
		input.today,
		cycle.targetHarvestDate,
		currentWeightG,
		targetWeightG,
	);

	// Reference line: what a straight stocking-to-target path would be today.
	const stockingWeightG = positive(cycle.stockingAvgWeightG);
	if (stockingWeightG !== null) {
		const totalDays = Math.max(1, daysBetween(cycle.stockingDate, cycle.targetHarvestDate));
		const elapsed = clamp(daysBetween(cycle.stockingDate, input.today), 0, totalDays);
		const expectedWeightG =
			stockingWeightG + (targetWeightG - stockingWeightG) * (elapsed / totalDays);
		plan.expectedWeightG = round1(expectedWeightG);
		plan.trackDeltaG = round1(currentWeightG - expectedWeightG);
		plan.trackDeltaPct = round1(((currentWeightG - expectedWeightG) / expectedWeightG) * 100);
		plan.track =
			plan.trackDeltaPct >= TRACK_TOLERANCE_PCT
				? "ahead"
				: plan.trackDeltaPct <= -TRACK_TOLERANCE_PCT
					? "behind"
					: "onTrack";
	}

	// Project harvest weight from the latest observed growth rate.
	const currentDate = input.latestSample?.date ?? cycle.stockingDate;
	const previous = input.previousSample;
	let dailyGainG: number | null = null;
	if (previous && previous.date < currentDate) {
		const span = daysBetween(previous.date, currentDate);
		if (span > 0) dailyGainG = (currentWeightG - previous.avgWeightG) / span;
	} else if (stockingWeightG !== null && cycle.stockingDate < currentDate) {
		const span = daysBetween(cycle.stockingDate, currentDate);
		if (span > 0) dailyGainG = (currentWeightG - stockingWeightG) / span;
	}
	plan.projectedHarvestWeightG =
		daysToHarvest <= 0
			? round1(currentWeightG)
			: dailyGainG !== null
				? round1(Math.max(0, currentWeightG + dailyGainG * daysToHarvest))
				: null;

	const targetGapG = Math.max(0, targetWeightG - currentWeightG);
	const currentBiomassG = currentWeightG * population * survivalPct;
	const fcrAssumption =
		input.latestFcr !== null && Number.isFinite(input.latestFcr)
			? clamp(input.latestFcr, MIN_FCR, MAX_FCR)
			: DEFAULT_TARGET_FCR;
	plan.feed.fcrAssumption = round2(fcrAssumption);

	if (targetGapG > 0 && daysToHarvest > 0 && input.feedsPerDay > 0) {
		plan.requiredDailyGainG = round1(targetGapG / daysToHarvest);
		const remainingFeedG = targetGapG * population * survivalPct * fcrAssumption;
		const dailyFeedG = remainingFeedG / daysToHarvest;
		plan.requiredDailyFeedKg = round2(dailyFeedG / 1000);
		plan.requiredFeedingRatePct =
			currentBiomassG > 0 ? round2((dailyFeedG / currentBiomassG) * 100) : null;
		plan.recommendedGramsPerFeeding = round1(dailyFeedG / input.feedsPerDay);
		plan.feed.remainingFeedKg = round2(remainingFeedG / 1000);
	} else if (targetGapG === 0) {
		plan.notes.push("Target weight reached or exceeded.");
	}

	if (stockingWeightG !== null && targetWeightG > stockingWeightG) {
		const totalGainG = (targetWeightG - stockingWeightG) * population * survivalPct;
		plan.feed.totalCycleFeedKg = round2((totalGainG * fcrAssumption) / 1000);
	}

	const maxGramsPerFeeding = positive(input.deviceMaxGramsPerFeeding) ?? MAX_FEED_GRAMS_PER_REQUEST;
	plan.device.maxGramsPerFeeding = maxGramsPerFeeding;
	plan.device.requiredGramsPerFeeding = plan.recommendedGramsPerFeeding;
	plan.device.feasible =
		plan.recommendedGramsPerFeeding === null ||
		plan.recommendedGramsPerFeeding <= maxGramsPerFeeding;
	plan.device.deficitGrams =
		plan.recommendedGramsPerFeeding !== null
			? Math.max(0, plan.recommendedGramsPerFeeding - maxGramsPerFeeding)
			: null;
	if (plan.device.deficitGrams !== null && plan.device.deficitGrams > 0) {
		const requiredMeals = Math.ceil(
			((plan.recommendedGramsPerFeeding ?? 0) * input.feedsPerDay) / maxGramsPerFeeding,
		);
		plan.device.extraMealsNeeded = Math.max(0, requiredMeals - input.feedsPerDay);
	}

	if (input.pond.feedPricePerKg !== null && positive(input.pond.feedPricePerKg) !== null) {
		const price = positive(input.pond.feedPricePerKg) as number;
		if (plan.feed.remainingFeedKg !== null) {
			plan.feed.estimatedRemainingCost = round2(plan.feed.remainingFeedKg * price);
			const harvestCount = population * survivalPct;
			plan.feed.estimatedCostPerFish =
				harvestCount > 0 ? round2((plan.feed.remainingFeedKg * price) / harvestCount) : null;
		}
	}

	const lastAdjustmentAt = input.lastAdjustmentAt;
	const daysSinceAdjustment =
		lastAdjustmentAt && isValidDateOnly(lastAdjustmentAt)
			? daysBetween(lastAdjustmentAt, input.today)
			: null;
	plan.nextAdjustmentDate =
		lastAdjustmentAt && isValidDateOnly(lastAdjustmentAt)
			? addDays(lastAdjustmentAt, ADJUSTMENT_INTERVAL_DAYS)
			: null;

	const currentGrams = positive(input.currentGramsPerFeeding);
	let block: GrowthPlanAdjustmentBlock = "none";
	if (!input.latestSample) {
		block = "noSample";
	} else if (daysSinceAdjustment !== null && daysSinceAdjustment < ADJUSTMENT_INTERVAL_DAYS) {
		block = "adjustmentWindow";
	} else if (plan.recommendedGramsPerFeeding === null) {
		block = targetGapG === 0 ? "noTarget" : "noSample";
	} else if (input.hasDevice === false) {
		block = "noDevice";
	} else if (!plan.device.feasible) {
		block = "deviceCap";
	}

	plan.adjustmentBlock = block;
	plan.adjustmentAllowed = block === "none";

	if (plan.recommendedGramsPerFeeding !== null) {
		if (currentGrams !== null) {
			const lower = currentGrams * (1 - MAX_ADJUSTMENT_PCT);
			const upper = currentGrams * (1 + MAX_ADJUSTMENT_PCT);
			plan.applicableGramsPerFeeding = round1(
				Math.min(Math.max(plan.recommendedGramsPerFeeding, lower), upper),
			);
			plan.adjustmentPct = round1(
				((plan.applicableGramsPerFeeding - currentGrams) / currentGrams) * 100,
			);
			plan.applicableGramsPerFeeding = Math.min(plan.applicableGramsPerFeeding, maxGramsPerFeeding);
		} else {
			plan.applicableGramsPerFeeding = round1(
				Math.min(plan.recommendedGramsPerFeeding, maxGramsPerFeeding),
			);
		}
	}

	const sampleCount = input.latestSample?.sampleCount ?? 0;
	const sampleAgeDays = plan.sampleAgeDays;
	const reasons: string[] = [];
	if (!input.latestSample) {
		reasons.push("noSample");
	} else if (sampleAgeDays !== null && sampleAgeDays > 21) {
		reasons.push("staleSample");
	} else if (sampleAgeDays !== null && sampleAgeDays > 7) {
		reasons.push("agingSample");
	} else {
		reasons.push("freshSample");
	}
	if (sampleCount < 10) reasons.push("smallSample");
	if (input.latestFcr === null) reasons.push("fcrAssumed");
	if (stockingWeightG === null) reasons.push("stockingWeightMissing");
	plan.confidenceReasons = reasons;
	plan.confidence =
		input.latestSample && sampleAgeDays !== null && sampleAgeDays <= 7 && sampleCount >= 30
			? "high"
			: input.latestSample && sampleAgeDays !== null && sampleAgeDays <= 21 && sampleCount >= 10
				? "medium"
				: "low";

	if (plan.density.advisory === "high") {
		plan.notes.push(
			`Stocking density is ${plan.density.fishPerM2} fish/m2, above the ${DENSITY_ADVISORY_PER_M2}/m2 advisory. Verify aeration and water exchange.`,
		);
	}
	if (plan.density.advisory === "unknown") {
		plan.notes.push("Add pond area and average depth to calculate stocking density.");
	}
	if (!plan.device.feasible && plan.recommendedGramsPerFeeding !== null) {
		plan.notes.push(
			`The target needs ${plan.recommendedGramsPerFeeding}g per meal, above the ${maxGramsPerFeeding}g device limit. Add meals or feeders.`,
		);
	}
	if (plan.adjustmentBlock === "adjustmentWindow" && plan.nextAdjustmentDate) {
		plan.notes.push(
			`The last adjustment was ${daysSinceAdjustment} days ago. The next one is available on ${plan.nextAdjustmentDate}.`,
		);
	}
	plan.notes.push(
		`Adjustments are capped at ${MAX_ADJUSTMENT_PCT * 100}% every ${ADJUSTMENT_INTERVAL_DAYS} days.`,
	);
	plan.notes.push(`Feed budget assumes FCR ${plan.feed.fcrAssumption}.`);

	return plan;
}
