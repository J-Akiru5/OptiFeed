import { PELLET_CRITICAL_PCT, PELLET_LOW_PCT } from "@/lib/constants";
import { type FeedLevelState, resolveFeedLevelDisplay } from "@/lib/feed-level-display";

export interface FeedLevelDisplayInput {
	levelPercent: number | null;
	updatedAt?: Date | null;
	isDeviceOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
	/** The org's low-hopper threshold, e.g. 20 or 30 %. */
	hopperLowPct?: number;
}

export interface FeedLevelDisplay {
	state: FeedLevelState;
	/** Last known percentage; an offline device keeps its last reading. */
	percent: number | null;
	readingAt: Date | null;
	hasReading: boolean;
	isOffline: boolean;
	isCritical: boolean;
	isLow: boolean;
	daysRemaining: number | null;
}

/**
 * Days of feed left in the hopper, as a fractional number, or null when it
 * cannot be estimated.
 *
 *   grams left   = hopper capacity × level %
 *   grams/day    = feed per meal × meals per day
 *   days left    = grams left ÷ grams/day
 *
 * This is the one implementation: the dashboard card formats it and the ingest
 * alert thresholds it. Every input is validated, so a missing capacity, an
 * uncalibrated device (0 g/s feeding) or a zero meal count yields null instead
 * of 0, Infinity or NaN.
 */
export function estimateDaysOfFeedRemaining(input: {
	levelPercent: number | null | undefined;
	hopperCapacityG: number | null | undefined;
	gramsPerFeeding: number | null | undefined;
	feedsPerDay: number | null | undefined;
}): number | null {
	const { levelPercent, hopperCapacityG, gramsPerFeeding, feedsPerDay } = input;
	if (typeof levelPercent !== "number" || !Number.isFinite(levelPercent)) return null;
	if (
		typeof hopperCapacityG !== "number" ||
		!Number.isFinite(hopperCapacityG) ||
		hopperCapacityG <= 0
	) {
		return null;
	}
	if (
		typeof gramsPerFeeding !== "number" ||
		!Number.isFinite(gramsPerFeeding) ||
		gramsPerFeeding <= 0
	) {
		return null;
	}
	if (typeof feedsPerDay !== "number" || !Number.isFinite(feedsPerDay) || feedsPerDay <= 0) {
		return null;
	}

	const dailyConsumption = gramsPerFeeding * feedsPerDay;
	if (!(dailyConsumption > 0)) return null;

	const percent = Math.min(100, Math.max(0, levelPercent));
	return (hopperCapacityG * (percent / 100)) / dailyConsumption;
}

/**
 * Resolve what the dashboard feed-level card should display.
 *
 * The presentation state itself comes from `resolveFeedLevelDisplay` so every
 * surface agrees on live / last-known / no-reading (decision E4, #192). This
 * adds the dashboard-only days-remaining estimate, which is only meaningful
 * while the device is online. The low/critical badges use the org's
 * `hopperLowPct` (the same threshold the alerts use) and the fixed critical
 * ceiling.
 */
export function getFeedLevelDisplay({
	levelPercent,
	updatedAt = null,
	isDeviceOffline,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
	hopperLowPct = PELLET_LOW_PCT,
}: FeedLevelDisplayInput): FeedLevelDisplay {
	const display = resolveFeedLevelDisplay({
		levelPercent,
		updatedAt,
		isOffline: isDeviceOffline,
	});
	const livePercent = display.state === "live" ? display.percent : null;

	const days = estimateDaysOfFeedRemaining({
		levelPercent: livePercent,
		hopperCapacityG,
		gramsPerFeeding,
		feedsPerDay,
	});
	const lowPct = Number.isFinite(hopperLowPct) ? hopperLowPct : PELLET_LOW_PCT;

	return {
		state: display.state,
		percent: display.percent,
		readingAt: display.readingAt,
		hasReading: display.state !== "none",
		isOffline: isDeviceOffline,
		isCritical: livePercent !== null && livePercent <= PELLET_CRITICAL_PCT,
		isLow: livePercent !== null && livePercent <= lowPct,
		daysRemaining: days === null ? null : Math.floor(days),
	};
}
