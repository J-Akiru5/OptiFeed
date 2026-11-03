import prisma from "@/lib/prisma";

/**
 * What the device reports back about the physical button's dose (issue #658).
 *
 * The dashboard now writes `EnergyDevice.buttonFeedGrams`, and the poll sends it
 * as `button_feed_grams`. A write is only a promise: the unit may be offline,
 * may not have polled yet, or may refuse the whole `config` object, in which
 * case it keeps its last-good dose. The firmware reports one `config_rev` for
 * the whole config and never the individual numbers, so the only device-side
 * evidence of the dose it is actually using is the `feed_dispensed` event a
 * button press produces. That row carries the grams the relay actually ran.
 *
 * "Confirmed" therefore means: the newest button press arrived AFTER the newest
 * recorded dose change and its weight matches the stored value. A press before
 * the change, or one that dispensed a different weight, is reported as
 * unconfirmed instead of being read as success.
 */

/** `DeviceStateEvent` type written by the dashboard when the dose changes. */
export const BUTTON_FEED_CHANGED_EVENT = "button_feed_changed";

/** Two floats closer than this are the same dose (stored values have 2 dp). */
const DOSE_EPSILON_G = 0.01;

export interface ButtonFeedPress {
	/** Grams the device reported dispensing on the press. */
	grams: number;
	/** Server receipt time of the report. */
	receivedAt: Date;
}

export interface ButtonFeedReport {
	/** False when the reads failed; the card then says so instead of guessing. */
	available: boolean;
	/** The value stored on the device row (what the next poll sends). */
	storedGrams: number;
	/** Most recent button-sourced dispense the device reported, or null. */
	lastPress: ButtonFeedPress | null;
	/** When the dose was last changed through the dashboard, or null. */
	changedAt: Date | null;
}

/**
 * - `confirmed`: a press after the change reported the stored dose.
 * - `unconfirmed`: a press exists but predates the change or reports another dose.
 * - `no_press`: the dose changed, but this device has never reported a press.
 * - `no_change`: no dashboard change is recorded, so there is nothing to confirm.
 * - `unavailable`: the report reads failed.
 */
export type ButtonFeedConfirmation =
	| "confirmed"
	| "unconfirmed"
	| "no_press"
	| "no_change"
	| "unavailable";

/** Reduce the stored dose, the audit time and the last press to one state. */
export function buttonFeedConfirmation(report: ButtonFeedReport): ButtonFeedConfirmation {
	if (!report.available) return "unavailable";
	if (!report.changedAt) return "no_change";
	if (!report.lastPress) return "no_press";
	const afterChange = report.lastPress.receivedAt.getTime() >= report.changedAt.getTime();
	const sameDose = Math.abs(report.lastPress.grams - report.storedGrams) < DOSE_EPSILON_G;
	return afterChange && sameDose ? "confirmed" : "unconfirmed";
}

/**
 * Load the last button press and the last dashboard change for one device.
 *
 * Never throws: the settings page must render even when this read fails, and a
 * failed read is reported as unavailable rather than as "no press".
 */
export async function loadButtonFeedReport(
	deviceId: string,
	storedGrams: number,
): Promise<ButtonFeedReport> {
	try {
		const [lastPress, change] = await Promise.all([
			prisma.feedEvent.findFirst({
				where: {
					deviceId,
					eventType: "feed_dispensed",
					source: "button",
					grams: { not: null },
					// A hand-adjusted or imported row is not a device report.
					dataSource: "device",
				},
				orderBy: { receivedAt: "desc" },
				select: { grams: true, receivedAt: true },
			}),
			prisma.deviceStateEvent.findFirst({
				where: { deviceId, eventType: BUTTON_FEED_CHANGED_EVENT },
				orderBy: { createdAt: "desc" },
				select: { createdAt: true },
			}),
		]);

		const grams = lastPress?.grams;
		const lastPressReport =
			lastPress && typeof grams === "number" && Number.isFinite(grams)
				? { grams, receivedAt: lastPress.receivedAt }
				: null;
		return {
			available: true,
			storedGrams,
			lastPress: lastPressReport,
			changedAt: change?.createdAt ?? null,
		};
	} catch (error) {
		console.warn(
			"[button-feed] the device's button-press report could not be read",
			error instanceof Error ? error.message : String(error),
		);
		return { available: false, storedGrams, lastPress: null, changedAt: null };
	}
}
