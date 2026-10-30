import { startOfDayInTimeZone } from "@/lib/chart-windows";
import { getDeviceFirmwareVersion } from "@/lib/device-firmware";
import { evaluateDeviceStatus, resolveRssiDbm } from "@/lib/device-status";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import type { FeederHeroData } from "@/lib/feeder-hero-types";
import { computeDeterministicPrediction } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { computeNextFeedingSlot } from "@/lib/schedule/next-feeding-slot";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * Read-only data for the feeder hero (task I-29, decision E29).
 *
 * Presentation only: nothing here writes, and every read is bounded to the
 * pond and device the calling page already resolved through its own guarded
 * loader (`getPondDetail`, `getActivePond`). The device lookup re-checks the
 * pond id so a mismatched pair returns null instead of leaking another pond's
 * readings.
 *
 * The schedule comes from `resolveCurrentSchedule` (a just-saved command must
 * win over the stale `Pond.*` row), the daily total from the same
 * `feed_dispensed` rows the charts use, and the advisor from the deterministic
 * prediction the dashboard already renders.
 */

export interface FeederHeroPond {
	id: string;
	isFallow: boolean;
	population: number | null;
	feedingRatePct: number;
	feedsPerDay: number;
	scheduleStart: Date;
	scheduleEnd: Date;
}

export interface LoadFeederHeroInput {
	pond: FeederHeroPond;
	deviceId: string;
	now?: Date;
}

export async function loadFeederHero({
	pond,
	deviceId,
	now = new Date(),
}: LoadFeederHeroInput): Promise<FeederHeroData | null> {
	const device = await prisma.energyDevice.findFirst({
		where: { id: deviceId, pondId: pond.id },
		select: {
			id: true,
			label: true,
			lastSeenAt: true,
			isPaused: true,
			feedLevelPercent: true,
			feedLevelUpdatedAt: true,
			waterTempC: true,
			waterTempOk: true,
			waterTempUpdatedAt: true,
			gramsPerFeeding: true,
			hopperCapacityG: true,
			dailyCapG: true,
			wifiRssiDbm: true,
			wifiRssiUpdatedAt: true,
		},
	});
	if (!device) return null;

	const todayStart = startOfDayInTimeZone(now);

	const [schedule, feedToday, firmware, latestBiomass, latestFcr, statusPolicy] = await Promise.all(
		[
			resolveCurrentSchedule(pond.id, device.id),
			prisma.feedEvent.aggregate({
				where: {
					deviceId: device.id,
					eventType: "feed_dispensed",
					// The hero is the device screen: an imported hand-fed daily total
					// did not come from this feeder and is not "dispensed today".
					source: { in: [...MACHINE_FEED_SOURCES] },
					receivedAt: { gte: todayStart },
				},
				_sum: { grams: true },
			}),
			getDeviceFirmwareVersion(device.id),
			prisma.biomassLog.findFirst({
				where: { pondId: pond.id },
				orderBy: { recordedAt: "desc" },
				select: { avgWeightKg: true, recordedAt: true },
			}),
			prisma.fcrReport.findFirst({
				where: { pondId: pond.id },
				orderBy: { periodEnd: "desc" },
				select: { fcrValue: true },
			}),
			getDeviceStatusPolicy(),
		],
	);

	const effective = schedule ?? {
		scheduleStart: pond.scheduleStart,
		scheduleEnd: pond.scheduleEnd,
		feedsPerDay: pond.feedsPerDay,
		feedingRatePct: pond.feedingRatePct,
	};

	const prediction = computeDeterministicPrediction(
		{
			feedingRatePct: effective.feedingRatePct,
			feedsPerDay: effective.feedsPerDay,
			population: pond.population,
			avgWeightKg: latestBiomass?.avgWeightKg ?? null,
			latestFcr: latestFcr?.fcrValue ?? null,
			currentGrams: device.gramsPerFeeding,
			hopperCapacityG: device.hopperCapacityG,
			dailyCapG: device.dailyCapG,
			lastSampleAt: latestBiomass?.recordedAt ?? null,
			isFallow: pond.isFallow,
			cycle: null,
		},
		now,
	);

	const rssiDbm = resolveRssiDbm({
		rssiDbm: device.wifiRssiDbm,
		updatedAt: device.wifiRssiUpdatedAt,
		now,
		policy: statusPolicy,
	});
	const connection = evaluateDeviceStatus({
		lastSeenAt: device.lastSeenAt,
		now,
		policy: statusPolicy,
		rssiDbm,
	});

	return {
		deviceLabel: device.label,
		connectionState: connection.state,
		isOffline: connection.isOffline,
		rssiDbm,
		isPaused: device.isPaused,
		lastSeenAt: device.lastSeenAt,
		hopperLevelPercent: device.feedLevelPercent,
		hopperUpdatedAt: device.feedLevelUpdatedAt,
		gramsToday: feedToday._sum.grams ?? 0,
		nextFeedSlot: computeNextFeedingSlot({
			scheduleStart: effective.scheduleStart,
			scheduleEnd: effective.scheduleEnd,
			feedsPerDay: effective.feedsPerDay,
			now,
		}),
		waterTempC: device.waterTempC,
		waterTempOk: device.waterTempOk,
		waterTempUpdatedAt: device.waterTempUpdatedAt,
		firmwareVersion: firmware?.version ?? null,
		advisor: {
			grams: prediction.grams,
			confidence: prediction.confidence,
			reasoning: prediction.reasoning || null,
		},
	};
}
