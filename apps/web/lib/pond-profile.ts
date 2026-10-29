import { z } from "zod";

/**
 * Pond profile values live in `Pond.notificationPrefs.profile` for the
 * pre-defense slice. Previews share the production database, so adding real
 * columns would require a production migration; this bridge keeps that
 * decision separate while giving the UI and plan engine one typed shape.
 *
 * Post-defense, move these fields to dedicated columns and keep this parser as
 * the read adapter.
 */
export interface PondProfile {
	areaM2: number | null;
	averageDepthM: number | null;
	feedPricePerKg: number | null;
}

export const EMPTY_POND_PROFILE: PondProfile = {
	areaM2: null,
	averageDepthM: null,
	feedPricePerKg: null,
};

export const pondProfileSchema = z.object({
	areaM2: z
		.number("Pond area must be a number")
		.positive("Pond area must be greater than 0")
		.max(1_000_000, "Pond area is too large")
		.nullish(),
	averageDepthM: z
		.number("Average depth must be a number")
		.positive("Average depth must be greater than 0")
		.max(50, "Average depth is too large")
		.nullish(),
	feedPricePerKg: z
		.number("Feed price must be a number")
		.min(0, "Feed price cannot be negative")
		.max(10_000, "Feed price is too large")
		.nullish(),
});

export type PondProfileInput = z.infer<typeof pondProfileSchema>;

/**
 * The harvest growth target saved from the feed calculator (issue #304).
 *
 * It lives in the same JSON bridge as the pond profile for the same reason: a
 * real column would require a production migration. The target is scoped to
 * the pond (the row that holds it) and to the tenant (`Pond.ownerId`), and it
 * names the crop cycle it was set for so a finished cycle cannot leak its
 * target into the next one.
 */
export interface PondGrowthTarget {
	/** Target average body weight per fish at harvest, in grams. */
	targetWeightG: number;
	/** Population used by the calculator; null when it was not provided. */
	population: number | null;
	/** The active cycle this target belongs to. */
	cycleId: string;
	/** When the target was saved, ISO 8601. */
	setAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parsePondProfile(prefs: unknown): PondProfile {
	if (!isRecord(prefs) || !isRecord(prefs.profile)) return { ...EMPTY_POND_PROFILE };
	const profile = prefs.profile;
	return {
		areaM2: finitePositive(profile.areaM2),
		averageDepthM: finitePositive(profile.averageDepthM),
		feedPricePerKg: finiteNonNegative(profile.feedPricePerKg),
	};
}

export function mergePondProfile(
	prefs: unknown,
	profile: Partial<PondProfileInput>,
): Record<string, unknown> {
	const base = isRecord(prefs) ? { ...prefs } : {};
	const existing = isRecord(base.profile) ? base.profile : {};
	const next = { ...existing };
	if (profile.areaM2 !== undefined) next.areaM2 = profile.areaM2 ?? null;
	if (profile.averageDepthM !== undefined) next.averageDepthM = profile.averageDepthM ?? null;
	if (profile.feedPricePerKg !== undefined) next.feedPricePerKg = profile.feedPricePerKg ?? null;
	return {
		...base,
		profile: next,
	};
}

/**
 * Read the saved harvest target. Anything incomplete or malformed is treated
 * as "no target" so a hand-edited or legacy JSON blob cannot produce a plan
 * with a missing cycle, date or weight.
 */
export function parsePondGrowthTarget(prefs: unknown): PondGrowthTarget | null {
	if (!isRecord(prefs) || !isRecord(prefs.profile)) return null;
	const raw = prefs.profile.growthTarget;
	if (!isRecord(raw)) return null;

	const targetWeightG = finitePositive(raw.targetWeightG);
	const cycleId = typeof raw.cycleId === "string" && raw.cycleId.length > 0 ? raw.cycleId : null;
	const setAt =
		typeof raw.setAt === "string" && !Number.isNaN(Date.parse(raw.setAt)) ? raw.setAt : null;
	if (targetWeightG === null || cycleId === null || setAt === null) return null;

	return {
		targetWeightG,
		population: finitePositive(raw.population),
		cycleId,
		setAt,
	};
}

/**
 * Store or clear the saved target without disturbing the rest of the pond
 * profile or the notification preferences that share this JSON column.
 */
export function mergePondGrowthTarget(
	prefs: unknown,
	target: PondGrowthTarget | null,
): Record<string, unknown> {
	const base = isRecord(prefs) ? { ...prefs } : {};
	const existing = isRecord(base.profile) ? { ...base.profile } : {};
	const profile =
		target === null
			? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "growthTarget"))
			: {
					...existing,
					growthTarget: {
						targetWeightG: target.targetWeightG,
						population: target.population,
						cycleId: target.cycleId,
						setAt: target.setAt,
					},
				};
	return {
		...base,
		profile,
	};
}
