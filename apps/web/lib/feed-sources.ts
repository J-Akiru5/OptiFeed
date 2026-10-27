/**
 * Where a recorded feeding came from.
 *
 * The feeder itself reports `scheduled`, `dashboard` and `button`. `hand_fed`
 * marks precision-feeding records that were fed by hand and imported from a
 * data sheet (they never came from the device). Anything else is shown as
 * "other" — never relabelled as a device source.
 */
export const FEED_EVENT_SOURCES = ["scheduled", "dashboard", "button", "hand_fed"] as const;

export type FeedEventSource = (typeof FEED_EVENT_SOURCES)[number];

export function feedSourceKey(source: string | null | undefined): FeedEventSource | "other" {
	return source && (FEED_EVENT_SOURCES as readonly string[]).includes(source)
		? (source as FeedEventSource)
		: "other";
}
