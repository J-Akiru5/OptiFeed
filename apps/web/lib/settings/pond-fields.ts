/**
 * The pond settings fields, named once (#371, #370).
 *
 * The same list drives three things that must never drift apart:
 *  - the form's inputs and inline errors,
 *  - the summary's "go to the field" links (`#inputId`),
 *  - the global-search deep links (`data-help` anchor + route + hash).
 *
 * `target` is the `data-help` anchor the highlight engine rings; `inputId` is
 * the real input so a plain page load also scrolls to it.
 */

export type PondSettingsField =
	| "feedingRatePct"
	| "feedsPerDay"
	| "sampleIntervalDays"
	| "population"
	| "areaM2"
	| "averageDepthM"
	| "feedPricePerKg";

export interface PondSettingsFieldSpec {
	field: PondSettingsField;
	/** The input's DOM id; also the URL hash a search result links to. */
	inputId: string;
	/** The `data-help` anchor wrapped around the control. */
	target: string;
	/** Message key under `dashboard.settings`. */
	labelKey: string;
}

export const POND_SETTINGS_FIELDS: readonly PondSettingsFieldSpec[] = [
	{
		field: "feedingRatePct",
		inputId: "feedingRate",
		target: "setting-pond-feeding-rate",
		labelKey: "rateLabel",
	},
	{
		field: "feedsPerDay",
		inputId: "feedsPerDay",
		target: "setting-pond-feeds-per-day",
		labelKey: "freqLabel",
	},
	{
		field: "sampleIntervalDays",
		inputId: "sampleInterval",
		target: "setting-pond-sample-interval",
		labelKey: "sampleIntervalLabel",
	},
	{
		field: "population",
		inputId: "population",
		target: "setting-pond-population",
		labelKey: "populationLabel",
	},
	{
		field: "areaM2",
		inputId: "areaM2",
		target: "setting-pond-area",
		labelKey: "areaLabel",
	},
	{
		field: "averageDepthM",
		inputId: "averageDepthM",
		target: "setting-pond-depth",
		labelKey: "depthLabel",
	},
	{
		field: "feedPricePerKg",
		inputId: "feedPricePerKg",
		target: "setting-pond-feed-price",
		labelKey: "feedPriceLabel",
	},
];

const BY_FIELD = new Map(POND_SETTINGS_FIELDS.map((spec) => [spec.field, spec]));

/** The spec for a field; the list above is exhaustive, so this never misses. */
export function pondFieldSpec(field: PondSettingsField): PondSettingsFieldSpec {
	const spec = BY_FIELD.get(field);
	if (!spec) throw new Error(`Unknown pond settings field: ${field}`);
	return spec;
}

/** Every `data-help` anchor the pond settings screen carries. */
export function pondSettingTargets(): string[] {
	return POND_SETTINGS_FIELDS.map((spec) => spec.target);
}
