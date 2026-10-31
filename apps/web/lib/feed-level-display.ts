import { HOPPER_LOW_DISPLAY_PCT } from "@/lib/constants";
import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceStatusPolicy,
	isDeviceOffline as resolveDeviceOffline,
} from "@/lib/device-status";

/** How a hopper-level reading should be presented. */
export type FeedLevelState = "live" | "stale" | "none";

export type FeedLevelDisplayState =
	| {
			/** The device is online and this is the current reading. */
			state: "live";
			percent: number;
			readingAt: Date | null;
			isOffline: false;
	  }
	| {
			/** The device is offline; show the last reading as last known. */
			state: "stale";
			percent: number;
			readingAt: Date | null;
			isOffline: true;
	  }
	| {
			/** No reading has ever arrived for this device. */
			state: "none";
			percent: null;
			readingAt: null;
			isOffline: boolean;
	  };

export interface FeedLevelDisplayInput {
	levelPercent: number | null;
	updatedAt: Date | null;
	isOffline: boolean;
}

/**
 * Display offline rule: the shared three-state helper's `offline` state, which
 * includes the platform-configured grace window (issue #388). A "weak signal"
 * device still has a usable last reading, so only a full offline state turns the
 * hopper level into "last known".
 */
export function isDeviceOffline(
	lastSeenAt: Date | null | undefined,
	now: Date = new Date(),
	policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY,
): boolean {
	return resolveDeviceOffline(lastSeenAt, now, policy);
}

/**
 * Resolve what a hopper-level surface should show (decision E4, #192).
 *
 * An offline feeder keeps a trustworthy last reading, so it is shown greyed out
 * as "last known" instead of being reset to 0% or a bright live figure. A device
 * that has never reported shows no reading at all.
 */
export function resolveFeedLevelDisplay({
	levelPercent,
	updatedAt,
	isOffline,
}: FeedLevelDisplayInput): FeedLevelDisplayState {
	if (levelPercent === null || !Number.isFinite(levelPercent)) {
		return { state: "none", percent: null, readingAt: null, isOffline };
	}

	const percent = Math.min(100, Math.max(0, Math.round(levelPercent)));

	if (isOffline) {
		return { state: "stale", percent, readingAt: updatedAt ?? null, isOffline: true };
	}

	return { state: "live", percent, readingAt: updatedAt ?? null, isOffline: false };
}

/**
 * #259: a live hopper reading at or below `HOPPER_LOW_DISPLAY_PCT` gets the
 * red, pulsing treatment. The raw reading is compared (not the rounded
 * display value), so 30.1 % is above the line while 30 % is on it. Offline is
 * handled by the caller: a last-known reading never blinks.
 */
export function isHopperLowDisplay(levelPercent: number | null): boolean {
	if (levelPercent === null || !Number.isFinite(levelPercent)) return false;
	return Math.min(100, Math.max(0, levelPercent)) <= HOPPER_LOW_DISPLAY_PCT;
}
