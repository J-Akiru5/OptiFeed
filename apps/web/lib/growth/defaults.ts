/**
 * Grow-out defaults (#826 part 2 / #828).
 *
 * Owner decision (2026-11-04): the three agronomic assumptions the cycle form
 * used to hardcode are configurable per farm, with a per-pond override. The
 * resolution order is:
 *
 *   pond override  →  farm default  →  documented constant
 *
 * The constant is the last resort so a fresh install, a farm with no settings
 * row, or a cleared field still produces a usable cycle form.
 *
 * Storage note: "farm default" lives on the organization settings row
 * (`OrgSetting`). In OptiFeed a `Farm` belongs to exactly one user and the
 * organization is the tenant/ownership boundary the owner decision refers to,
 * so the org-wide row is the farm default for every pond that farm owns. The
 * per-pond override lives in `PondGrowthOverride`.
 *
 * This module is pure so the settings forms, the cycle dialog and the unit
 * tests can share one definition. The database reader is
 * `lib/growth/defaults-loader.ts`.
 */

export const GROWTH_DEFAULT_FIELDS = [
	"growOutDays",
	"targetHarvestWeightG",
	"expectedSurvivalPct",
	"stockingAvgWeightG",
	"densityAdvisoryPerM2",
] as const;

export type GrowthDefaultField = (typeof GROWTH_DEFAULT_FIELDS)[number];

/** A partial set of stored values. `null` means "not set — inherit the next layer". */
export interface GrowthDefaults {
	growOutDays: number | null;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
	stockingAvgWeightG: number | null;
	densityAdvisoryPerM2: number | null;
}

export const EMPTY_GROWTH_DEFAULTS: GrowthDefaults = {
	growOutDays: null,
	targetHarvestWeightG: null,
	expectedSurvivalPct: null,
	stockingAvgWeightG: null,
	densityAdvisoryPerM2: null,
};

/**
 * The documented constants. These are the only literals for these values:
 * the cycle dialog, the assistant and the chat agent all read them from here
 * so the surfaces cannot disagree (acceptance criterion: the 85 % literal
 * exists in exactly one place).
 *
 * `stockingAvgWeightG` has no historical constant — the field has always been
 * optional and empty unless the operator typed a value, so its system default
 * is `null`.
 */
export const SYSTEM_GROWTH_DEFAULTS = {
	growOutDays: 135,
	targetHarvestWeightG: 250,
	expectedSurvivalPct: 85,
	stockingAvgWeightG: null,
	densityAdvisoryPerM2: 20,
} as const;

/** The global validation rails. They stay global on purpose (issue #826). */
export const MIN_GROW_OUT_DAYS = 30;
export const MAX_GROW_OUT_DAYS = 365;

export interface GrowthDefaultBound {
	min: number;
	max: number;
	integer: boolean;
}

export const GROWTH_DEFAULT_BOUNDS: Record<GrowthDefaultField, GrowthDefaultBound> = {
	growOutDays: { min: MIN_GROW_OUT_DAYS, max: MAX_GROW_OUT_DAYS, integer: true },
	targetHarvestWeightG: { min: 1, max: 10_000, integer: false },
	expectedSurvivalPct: { min: 1, max: 100, integer: false },
	stockingAvgWeightG: { min: 0.1, max: 10_000, integer: false },
	densityAdvisoryPerM2: { min: 1, max: 1_000, integer: false },
};

/** True when `value` is a finite number inside the field's global rails. */
export function isValidGrowthDefaultValue(
	field: GrowthDefaultField,
	value: unknown,
): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	const bound = GROWTH_DEFAULT_BOUNDS[field];
	if (bound.integer && !Number.isInteger(value)) return false;
	return value >= bound.min && value <= bound.max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coerce a stored row into a complete, safe override set.
 *
 * Malformed or out-of-range values become `null` (inherit) rather than being
 * clamped: a hand-edited row must never silently invent a value the operator
 * did not choose. The constant then applies, which is visible in the UI as
 * "System default".
 */
export function sanitizeGrowthDefaults(value: unknown): GrowthDefaults {
	const source = isRecord(value) ? value : {};
	const result = { ...EMPTY_GROWTH_DEFAULTS };
	for (const field of GROWTH_DEFAULT_FIELDS) {
		const candidate = source[field];
		result[field] = isValidGrowthDefaultValue(field, candidate) ? candidate : null;
	}
	return result;
}

/** `true` when every field is unset (an empty override row). */
export function isEmptyGrowthDefaults(value: GrowthDefaults): boolean {
	return GROWTH_DEFAULT_FIELDS.every((field) => value[field] === null);
}

export type GrowthDefaultSource = "pond" | "farm" | "system";

export interface ResolvedGrowthDefault {
	/** The value in effect. `null` only for `stockingAvgWeightG` at system level. */
	value: number | null;
	source: GrowthDefaultSource;
}

export type ResolvedGrowthDefaults = Record<GrowthDefaultField, ResolvedGrowthDefault>;

/**
 * Apply the documented resolution order once per field.
 *
 * Inputs are treated as already sanitized; a malformed value is still ignored
 * here so a caller cannot smuggle one past `sanitizeGrowthDefaults`.
 */
export function resolveGrowthDefaults(
	farm: Partial<GrowthDefaults> | null | undefined,
	pond: Partial<GrowthDefaults> | null | undefined,
): ResolvedGrowthDefaults {
	const result = {} as ResolvedGrowthDefaults;
	for (const field of GROWTH_DEFAULT_FIELDS) {
		const override = pond?.[field];
		if (isValidGrowthDefaultValue(field, override)) {
			result[field] = { value: override, source: "pond" };
			continue;
		}
		const farmValue = farm?.[field];
		if (isValidGrowthDefaultValue(field, farmValue)) {
			result[field] = { value: farmValue, source: "farm" };
			continue;
		}
		result[field] = { value: SYSTEM_GROWTH_DEFAULTS[field], source: "system" };
	}
	return result;
}

/**
 * Map the short field names used by the resolver onto the organization
 * settings' `default*` column names.
 */
export function orgGrowthColumns(growth: GrowthDefaults) {
	return {
		defaultGrowOutDays: growth.growOutDays,
		defaultTargetHarvestWeightG: growth.targetHarvestWeightG,
		defaultExpectedSurvivalPct: growth.expectedSurvivalPct,
		defaultStockingAvgWeightG: growth.stockingAvgWeightG,
		densityAdvisoryPerM2: growth.densityAdvisoryPerM2,
	};
}
