/**
 * Shared shapes for the feeder hero (task I-29, decision E29).
 *
 * Kept in a dependency-free module so the client component, the server loader
 * and the tests can all import it without pulling Prisma or auth into the
 * browser bundle.
 */

export type FeederHeroConfidence = "low" | "medium" | "high";

/** The one-line AI Feed Advisor summary shown under the hero. */
export interface FeederHeroAdvisor {
	/** Recommended grams per meal, or null when there is not enough data. */
	grams: number | null;
	confidence: FeederHeroConfidence;
	reasoning: string | null;
}

/** Everything the hero renders. Assembled by `loadFeederHero` on the server. */
import type { DeviceConnectionState } from "@/lib/device-status";
import type { NextFeedingSlot } from "@/lib/schedule/next-feeding-slot";

export interface FeederHeroData {
	deviceLabel: string;
	/** Online, weak signal or offline (issue #388). */
	connectionState: DeviceConnectionState;
	/** True only when the feeder is fully offline. */
	isOffline: boolean;
	isPaused: boolean;
	lastSeenAt: Date | null;
	hopperLevelPercent: number | null;
	hopperUpdatedAt: Date | null;
	/** Grams dispensed since local midnight; 0 when nothing was fed today. */
	gramsToday: number;
	/** Next slot in the farm's wall clock; null when the schedule is invalid. */
	nextFeedSlot: NextFeedingSlot | null;
	waterTempC: number | null;
	waterTempOk: boolean;
	waterTempUpdatedAt: Date | null;
	firmwareVersion: string | null;
	advisor: FeederHeroAdvisor | null;
}

/**
 * Jeff's photo, dropped in without a code change. Until it exists the hero
 * shows the drawn illustration (see `public/images/feeder/README.md`).
 */
export const FEEDER_HERO_PHOTO_PATH = "/images/feeder/feeder-hero.webp";

/**
 * Session flag written after the photo fails to load, so a missing file costs
 * one request per browser session instead of one per page view.
 */
export const FEEDER_HERO_PHOTO_SESSION_KEY = "optifeed:feeder-hero-photo-missing";
