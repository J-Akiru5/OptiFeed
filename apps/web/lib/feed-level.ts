export interface FeedLevelDisplayInput {
	levelPercent: number | null;
	isDeviceOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
}

export interface FeedLevelDisplay {
	/** Percentage to render; an offline device rests at 0. */
	percent: number | null;
	hasReading: boolean;
	isOffline: boolean;
	isCritical: boolean;
	isLow: boolean;
	daysRemaining: number | null;
}

/**
 * Resolve what the feed-level card should display.
 *
 * An offline ESP32 cannot be trusted to still hold the feed it last reported,
 * so the dashboard rests at 0% like the sidebar instead of freezing on a stale
 * reading (GH-100 / GH-113).
 */
export function getFeedLevelDisplay({
	levelPercent,
	isDeviceOffline,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
}: FeedLevelDisplayInput): FeedLevelDisplay {
	const percent = isDeviceOffline ? 0 : levelPercent;
	const hasReading = percent !== null;

	const dailyConsumption = gramsPerFeeding * feedsPerDay;
	const daysRemaining =
		!isDeviceOffline && percent !== null && hopperCapacityG && dailyConsumption > 0
			? Math.floor((hopperCapacityG * (percent / 100)) / dailyConsumption)
			: null;

	return {
		percent,
		hasReading,
		isOffline: isDeviceOffline,
		isCritical: !isDeviceOffline && percent !== null && percent <= 5,
		isLow: !isDeviceOffline && percent !== null && percent <= 20,
		daysRemaining,
	};
}
