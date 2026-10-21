import { completeAi, isAiEnabled, stableSessionId } from "@/lib/ai";
import { MAX_FEED_GRAMS_PER_REQUEST, dailyFeedCapG } from "@/lib/limits";
import { calculateNextFeeding } from "@/lib/volumeCalc";

// Same threshold the biomass auto-adjust veto uses (lib/actions/biomass.ts).
export const PREDICTION_DEVIATION_THRESHOLD = 0.5;

// Reference FCR for African catfish under good management (matches
// lib/fcr-calculation.ts). Predictions adjust the feeding rate relative to it.
export const REFERENCE_FCR = 1.5;

// How recent a biomass sample must be for a "high" confidence prediction.
const FRESH_SAMPLE_DAYS = 21;

// FCR adjustment is bounded so a single bad report can't swing the rate wildly.
const FCR_ADJUST_MIN = 0.85;
const FCR_ADJUST_MAX = 1.15;

export type PredictionConfidence = "low" | "medium" | "high";
export type PredictionSource = "ai" | "deterministic";

export interface PredictionInputs {
	feedingRatePct: number;
	feedsPerDay: number;
	population: number | null;
	avgWeightKg: number | null;
	latestFcr: number | null;
	currentGrams: number | null;
	hopperCapacityG: number | null;
	lastSampleAt: Date | null;
}

export interface FeedingPrediction {
	grams: number | null;
	baselineGrams: number | null;
	currentGrams: number | null;
	confidence: PredictionConfidence;
	reasoning: string;
	source: PredictionSource;
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function daysBetween(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Upper bound for per-meal grams from device safety limits:
 * feedGramsSchema max, and the daily cap spread across feedsPerDay.
 */
export function predictionUpperBound(feedsPerDay: number, hopperCapacityG: number | null): number {
	const dailyCapPerMeal =
		feedsPerDay > 0 ? dailyFeedCapG(hopperCapacityG) / feedsPerDay : MAX_FEED_GRAMS_PER_REQUEST;
	return Math.min(MAX_FEED_GRAMS_PER_REQUEST, Math.max(1, dailyCapPerMeal));
}

/**
 * Clamps a candidate per-meal grams value into the safe envelope:
 * [1, min(1000, dailyCap/feedsPerDay)] ∩ [current × (1±50%)] when current is valid.
 * Returns the clamped value plus whether/how it was clamped.
 */
export function clampPredictionGrams(
	candidate: number,
	inputs: Pick<PredictionInputs, "feedsPerDay" | "hopperCapacityG" | "currentGrams">,
): { grams: number; clamped: boolean } {
	const upper = predictionUpperBound(inputs.feedsPerDay, inputs.hopperCapacityG);
	let grams = Math.min(Math.max(candidate, 1), upper);
	let clamped = grams !== candidate;

	const current = inputs.currentGrams;
	const currentValid = current !== null && Number.isFinite(current) && current > 0;
	if (currentValid) {
		const minDev = current * (1 - PREDICTION_DEVIATION_THRESHOLD);
		const maxDev = current * (1 + PREDICTION_DEVIATION_THRESHOLD);
		const devClamped = Math.min(Math.max(grams, minDev), maxDev);
		if (devClamped !== grams) clamped = true;
		grams = devClamped;
	}

	return { grams: round1(grams), clamped };
}

/**
 * Deterministic per-meal feed prediction — always available, no AI needed.
 *
 * 1. Baseline: standard formula (biomass × feedingRatePct ÷ feedsPerDay).
 * 2. FCR adjustment: better-than-reference FCR → slightly more feed (fish are
 *    converting efficiently, push growth); worse → less feed (avoid waste).
 * 3. Clamp to device safety limits and the ±50% deviation envelope.
 */
export function computeDeterministicPrediction(
	inputs: PredictionInputs,
	now: Date = new Date(),
): FeedingPrediction {
	const { avgWeightKg, feedsPerDay, population, feedingRatePct, latestFcr } = inputs;

	if (!avgWeightKg || avgWeightKg <= 0 || feedsPerDay <= 0 || feedingRatePct <= 0) {
		return {
			grams: null,
			baselineGrams: null,
			currentGrams: inputs.currentGrams,
			confidence: "low",
			reasoning: "Not enough data to predict — log a biomass sample and check pond settings.",
			source: "deterministic",
		};
	}

	const baseline = calculateNextFeeding(avgWeightKg, feedingRatePct, feedsPerDay, population);

	let adjustedRate = feedingRatePct;
	let fcrNote = "";
	if (latestFcr !== null && latestFcr > 0) {
		const factor = Math.min(Math.max(REFERENCE_FCR / latestFcr, FCR_ADJUST_MIN), FCR_ADJUST_MAX);
		adjustedRate = feedingRatePct * factor;
		const pct = ((factor - 1) * 100).toFixed(1);
		fcrNote =
			factor >= 1
				? ` Your FCR of ${latestFcr.toFixed(2)} is better than the ${REFERENCE_FCR} reference, so the rate is nudged up ${pct}% to push growth.`
				: ` Your FCR of ${latestFcr.toFixed(2)} is above the ${REFERENCE_FCR} reference, so the rate is trimmed ${pct}% to reduce waste.`;
	}

	const adjusted = calculateNextFeeding(avgWeightKg, adjustedRate, feedsPerDay, population);
	const { grams } = clampPredictionGrams(adjusted, inputs);

	const sampleAge =
		inputs.lastSampleAt !== null ? Math.round(daysBetween(now, inputs.lastSampleAt)) : null;
	const confidence: PredictionConfidence =
		latestFcr !== null && sampleAge !== null && sampleAge <= FRESH_SAMPLE_DAYS
			? "high"
			: sampleAge !== null && sampleAge <= FRESH_SAMPLE_DAYS * 2
				? "medium"
				: "low";

	const ageNote =
		sampleAge !== null
			? `latest sample ${sampleAge} day${sampleAge === 1 ? "" : "s"} ago`
			: "sample date unknown";

	const currentNote =
		inputs.currentGrams !== null ? ` Current device value is ${inputs.currentGrams}g.` : "";

	const reasoning = `Standard feed math (biomass × ${feedingRatePct}% ÷ ${feedsPerDay} meals) gives ${round1(baseline)}g per meal from your ${ageNote}.${fcrNote}${currentNote}`;

	return {
		grams,
		baselineGrams: round1(baseline),
		currentGrams: inputs.currentGrams,
		confidence,
		reasoning,
		source: "deterministic",
	};
}

function extractJson(text: string): unknown {
	const trimmed = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
}

function buildAiPrompt(inputs: PredictionInputs, baseline: FeedingPrediction): string {
	return `You are an aquaculture nutritionist for African catfish (Clarias gariepinus) in the Philippines.
Recommend the feed grams per meal for an automated feeder. Consider the data, growth efficiency, and feed waste.

POND DATA:
- Feeding rate: ${inputs.feedingRatePct}% of body weight per day
- Feeds per day: ${inputs.feedsPerDay}
- Population: ${inputs.population ?? "unknown"} fish
- Latest average body weight: ${inputs.avgWeightKg} kg
- Latest FCR: ${inputs.latestFcr?.toFixed(2) ?? "no data"}
- Current device grams per feeding: ${inputs.currentGrams ?? "unknown"}g
- Standard formula baseline: ${baseline.baselineGrams ?? "unknown"}g per meal

Respond with ONLY a JSON object, no other text:
{"grams": <number, per-meal grams>, "confidence": "low"|"medium"|"high", "reasoning": "<max 180 char plain-text explanation for the farmer>"}`;
}

/**
 * Refines a deterministic prediction with the AI provider (best-effort).
 * The AI output is clamped into the same safe envelope as the baseline — it can
 * never exceed device limits or the ±50% deviation band. Any failure (no key,
 * quota, malformed JSON) returns the baseline unchanged.
 */
export async function refinePredictionWithAi(
	inputs: PredictionInputs,
	baseline: FeedingPrediction,
	sessionId: string = stableSessionId("prediction", new Date().toISOString().slice(0, 10)),
): Promise<FeedingPrediction> {
	if (!isAiEnabled() || baseline.grams === null) return baseline;

	try {
		const result = await completeAi(
			[{ role: "user", text: buildAiPrompt(inputs, baseline) }],
			"You output strict JSON only. No markdown, no prose outside the JSON object.",
			sessionId,
		);
		if (!result?.content) return baseline;

		const parsed = extractJson(result.content) as {
			grams?: unknown;
			confidence?: unknown;
			reasoning?: unknown;
		} | null;
		if (!parsed || typeof parsed.grams !== "number" || !Number.isFinite(parsed.grams)) {
			return baseline;
		}

		const { grams, clamped } = clampPredictionGrams(parsed.grams, inputs);
		const confidence: PredictionConfidence =
			parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
				? parsed.confidence
				: baseline.confidence;

		const aiReasoning =
			typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
				? parsed.reasoning.trim().slice(0, 220)
				: baseline.reasoning;

		return {
			grams,
			baselineGrams: baseline.baselineGrams,
			currentGrams: baseline.currentGrams,
			confidence,
			reasoning: clamped
				? `${aiReasoning} (Adjusted to stay within safe device limits.)`
				: aiReasoning,
			source: "ai",
		};
	} catch (error) {
		console.error("[prediction] AI refinement failed, using deterministic baseline:", error);
		return baseline;
	}
}

/**
 * Full prediction pipeline: deterministic baseline (always) + AI refinement
 * (best-effort). Used by /api/predict-feeding.
 */
export async function predictFeeding(
	inputs: PredictionInputs,
	now: Date = new Date(),
	sessionId: string = stableSessionId("prediction", now.toISOString().slice(0, 10)),
): Promise<FeedingPrediction> {
	const baseline = computeDeterministicPrediction(inputs, now);
	return refinePredictionWithAi(inputs, baseline, sessionId);
}
