import { type FeedLevelState, resolveFeedLevelDisplay } from "@/lib/feed-level-display";

export interface FeedLevelDisplayInput {
	levelPercent: number | null;
	updatedAt?: Date | null;
	isDeviceOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
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
 * Resolve what the dashboard feed-level card should display.
 *
 * The presentation state itself comes from `resolveFeedLevelDisplay` so every
 * surface agrees on live / last-known / no-reading (decision E4, #192). This
 * adds the dashboard-only days-remaining estimate, which is only meaningful
 * while the device is online.
 */
export function getFeedLevelDisplay({
	levelPercent,
	updatedAt = null,
	isDeviceOffline,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
}: FeedLevelDisplayInput): FeedLevelDisplay {
	const display = resolveFeedLevelDisplay({
		levelPercent,
		updatedAt,
		isOffline: isDeviceOffline,
	});
	const livePercent = display.state === "live" ? display.percent : null;

	const dailyConsumption = gramsPerFeeding * feedsPerDay;
	const daysRemaining =
		livePercent !== null && hopperCapacityG && dailyConsumption > 0
			? Math.floor((hopperCapacityG * (livePercent / 100)) / dailyConsumption)
			: null;

	return {
		state: display.state,
		percent: display.percent,
		readingAt: display.readingAt,
		hasReading: display.state !== "none",
		isOffline: isDeviceOffline,
		isCritical: livePercent !== null && livePercent <= 5,
		isLow: livePercent !== null && livePercent <= 20,
		daysRemaining,
	};
}
