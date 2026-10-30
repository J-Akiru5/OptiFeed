import { manilaDayRange } from "@/lib/feed/day";
import { type FeedNowLimit, resolveDailyCapG, resolveFeedNowLimitG } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";

/**
 * The effective Feed Now ceiling for a device (issue #387, decision E30),
 * loaded on the server so every dialog can show it before the request is sent.
 *
 * It reuses the same resolved daily cap and Asia/Manila day window as
 * `createManualFeedRequest`, so the number in the dialog and the number the
 * server enforces cannot disagree.
 */
export interface FeedNowLimitDevice {
	id: string;
	gramsPerFeeding: number;
	dailyCapG: number | null;
	hopperCapacityG: number | null;
}

export async function getFeedNowLimitForDevice(device: FeedNowLimitDevice): Promise<FeedNowLimit> {
	const limits = await getFeedingLimits();
	const day = manilaDayRange();

	// The dialog only needs the limit; if the usage read fails (for example in
	// a page test double), fall back to zero used today. The manual-feed command
	// re-reads the usage and enforces the daily cap server-side.
	let usedTodayG = 0;
	try {
		const today = await prisma.feedRequest.aggregate({
			where: {
				deviceId: device.id,
				status: { in: ["pending", "dispatched", "completed"] },
				createdAt: { gte: day.start, lt: day.end },
			},
			_sum: { grams: true },
		});
		usedTodayG = today._sum.grams ?? 0;
	} catch {
		usedTodayG = 0;
	}

	return resolveFeedNowLimitG({
		perMealG: device.gramsPerFeeding,
		dailyCapG: resolveDailyCapG({
			configuredCapG: device.dailyCapG,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapFactor: limits.dailyCapFactor,
		}),
		usedTodayG,
	});
}
