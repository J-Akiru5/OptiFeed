/**
 * The pond's sampling cadence, in one place (#886).
 *
 * The calendar event generator (`lib/calendar/event-sources.ts`) and the crop
 * reminder scheduler (`lib/crop-cycle/reminders.ts`) both derive "sampling
 * due" from `Pond.sampleIntervalDays`, with the same fallback for a legacy
 * pond whose value is missing or invalid. The biomass batch summary reads this
 * helper too, so the rate the operator is shown is the rate the scheduler is
 * actually working to, rather than a sentence that can drift from the code.
 */

/** Used when a legacy row has no usable interval. Matches the Prisma default. */
export const DEFAULT_SAMPLE_INTERVAL_DAYS = 14;

/** A whole, positive day count; anything else falls back to the default. */
export function resolveSampleIntervalDays(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.round(value)
		: DEFAULT_SAMPLE_INTERVAL_DAYS;
}
