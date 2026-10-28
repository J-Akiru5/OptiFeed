import { type FeedLevelState, resolveFeedLevelDisplay } from "@/lib/feed-level-display";

export interface FeedLevelDisplayInput {
	levelPercent: number | null;
	updatedAt?: Date | null;
	isDeviceOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
}

export interface FeedLevelRemaining {
	/** Feed left in the hopper, in grams. Null when capacity or level is unknown. */
	remainingGrams: number | null;
	/** Whole scheduled feedings left at the device's grams-per-feeding. */
	feedingsRemaining: number | null;
	/** Whole days of feed left at the current schedule. */
	daysRemaining: number | null;
}

export interface FeedLevelDisplay extends FeedLevelRemaining {
	state: FeedLevelState;
	/** Last known percentage; an offline device keeps its last reading. */
	percent: number | null;
	readingAt: Date | null;
	hasReading: boolean;
	isOffline: boolean;
	isCritical: boolean;
	isLow: boolean;
}

/**
 * Remaining feed from one level reading.
 *
 * The level, the hopper capacity and the device's grams-per-feeding are the
 * only inputs, so the sidebar, the dashboard card and the hardware page can
 * never quote different "kg remaining" or "feedings left" for the same
 * reading (#263). A missing/zero capacity, meal size or meal count returns
 * null instead of Infinity.
 */
export function estimateFeedRemaining({
	levelPercent,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
}: Pick<
	FeedLevelDisplayInput,
	"levelPercent" | "hopperCapacityG" | "gramsPerFeeding" | "feedsPerDay"
>): FeedLevelRemaining {
	const hasLevel = levelPercent !== null && Number.isFinite(levelPercent);
	const hasCapacity =
		typeof hopperCapacityG === "number" && Number.isFinite(hopperCapacityG) && hopperCapacityG > 0;
	const hasMeal = Number.isFinite(gramsPerFeeding) && gramsPerFeeding > 0;
	const hasDay = Number.isFinite(feedsPerDay) && feedsPerDay > 0;

	const remainingGrams =
		hasLevel && hasCapacity ? hopperCapacityG * (Math.max(0, levelPercent) / 100) : null;
	const feedingsRemaining =
		remainingGrams !== null && hasMeal ? Math.floor(remainingGrams / gramsPerFeeding) : null;
	const dailyConsumption = hasMeal && hasDay ? gramsPerFeeding * feedsPerDay : null;
	const daysRemaining =
		remainingGrams !== null && dailyConsumption !== null && dailyConsumption > 0
			? Math.floor(remainingGrams / dailyConsumption)
			: null;

	return { remainingGrams, feedingsRemaining, daysRemaining };
}

/**
 * Resolve what a hopper surface should display.
 *
 * The presentation state itself comes from `resolveFeedLevelDisplay` so every
 * surface agrees on live / last-known / no-reading (decision E4, #192). The
 * remaining-feed estimates are only meaningful while the device is online.
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
	const remaining = estimateFeedRemaining({
		levelPercent: livePercent,
		hopperCapacityG,
		gramsPerFeeding,
		feedsPerDay,
	});

	return {
		state: display.state,
		percent: display.percent,
		readingAt: display.readingAt,
		hasReading: display.state !== "none",
		isOffline: isDeviceOffline,
		isCritical: livePercent !== null && livePercent <= 5,
		isLow: livePercent !== null && livePercent <= 20,
		...remaining,
	};
}
