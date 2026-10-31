import { resolveActivePond } from "@/lib/auth/pond-access";
import { resolveDailyCapG } from "@/lib/limits-core";
import prisma from "@/lib/prisma";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";
import { resolveCurrentSchedule } from "./resolve-current";
import { feedingSlotMinutes, formatClock } from "./slots";

/**
 * The feeding schedule as sheet rows (I-107): one row per meal, in feeding
 * order, from the schedule the dashboard shows (a pending change wins over the
 * last applied one). `grams` is the dose the feeder currently derives from the
 * pond settings; `enabled` mirrors the schedule pause.
 */
export async function buildScheduleRows(
	pondId: string,
): Promise<{ time: string; grams: number | null; enabled: boolean }[]> {
	const device = await prisma.energyDevice.findFirst({
		where: { pondId },
		orderBy: { createdAt: "asc" },
		select: { id: true, isPaused: true, gramsPerFeeding: true },
	});
	const config = await resolveCurrentSchedule(pondId, device?.id ?? null);
	if (!config) return [];

	const minutesOf = (value: Date) => value.getUTCHours() * 60 + value.getUTCMinutes();
	return feedingSlotMinutes(
		minutesOf(config.scheduleStart),
		minutesOf(config.scheduleEnd),
		config.feedsPerDay,
	).map((minutes) => ({
		time: formatClock(minutes),
		grams: device?.gramsPerFeeding ?? null,
		enabled: !(device?.isPaused ?? false),
	}));
}

export interface ScheduleCapCheck {
	feedsPerDay: number;
	/** What the feeder would dispense in a day: meals times the current dose. */
	dailyG: number;
	/** The pond's daily feed ceiling, the only gram cap. */
	capG: number;
	overCap: boolean;
}

/** The same daily-cap comparison `updateScheduleCommand` makes, shown before the user confirms. */
export async function checkScheduleAgainstCap(
	ownerId: string,
	feedsPerDay: number,
): Promise<ScheduleCapCheck | null> {
	const pond = await resolveActivePond(ownerId);
	if (!pond) return null;
	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { dailyCapG: true, hopperCapacityG: true, gramsPerFeeding: true },
	});
	if (!device) return null;

	const limits = await getFeedingLimits();
	const capG = resolveDailyCapG({
		configuredCapG: device.dailyCapG,
		hopperCapacityG: device.hopperCapacityG,
		dailyCapFactor: limits.dailyCapFactor,
	});
	const dailyG = feedsPerDay * device.gramsPerFeeding;
	return { feedsPerDay, dailyG, capG, overCap: dailyG > capG };
}
