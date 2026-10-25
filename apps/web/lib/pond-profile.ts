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
