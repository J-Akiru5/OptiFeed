import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import prisma from "@/lib/prisma";
import type { DriftFeedSample, DriftLevelSample } from "./drift";

/**
 * The seven-day inputs for the rule-based calibration drift check (E8).
 *
 * One implementation, so the dashboard, the hardware page and the assistant
 * cannot disagree about what "drift" compares: the grams **the device
 * dispensed** against the hopper level it reported. Imported `hand_fed` daily
 * totals are feed the pond received by hand, never device output, so they are
 * excluded — including one that was imported today for an older day.
 *
 * Audit: `docs/audits/2026-10-28-calc-device.md` #6.
 */

export const DRIFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CalibrationDriftWindow {
	feeds: DriftFeedSample[];
	levels: DriftLevelSample[];
	/** Start instant of the window, for callers that want to explain it. */
	start: Date;
}

export async function loadCalibrationDriftWindow(
	deviceId: string,
	now: Date = new Date(),
): Promise<CalibrationDriftWindow> {
	const start = new Date(now.getTime() - DRIFT_WINDOW_MS);

	const [feeds, levels] = await Promise.all([
		prisma.feedEvent.findMany({
			where: {
				deviceId,
				eventType: "feed_dispensed",
				source: { in: [...MACHINE_FEED_SOURCES] },
				receivedAt: { gte: start },
			},
			select: { grams: true, receivedAt: true },
		}),
		prisma.feedLevelLog.findMany({
			where: { deviceId, recordedAt: { gte: start } },
			orderBy: { recordedAt: "asc" },
			select: { levelPercent: true, recordedAt: true },
		}),
	]);

	return { feeds, levels, start };
}
