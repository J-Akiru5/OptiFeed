import { resolveDailyCapG } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getFeedingLimits } from "@/lib/settings/feeding-caps";

/**
 * The feeding configuration for exactly one pond (Amendment A-001, D5).
 *
 * Every screen and server action that needs a feeding number should read it
 * through this function instead of querying `Pond`/`EnergyDevice` itself:
 *
 * - it is scoped by `pondId`, so a farm with several ponds cannot read the
 *   wrong row (`findFirst({ ownerId })` is forbidden for feeding data);
 * - a pending `ScheduleCommand` overrides the stored `Pond` row, matching what
 *   the firmware will actually apply;
 * - the population is returned as `null` when the pond has no real count, so
 *   callers cannot silently assume 5,000 fish;
 * - the daily ceiling is already resolved through the one cap function, with
 *   the platform factor and hopper limit applied.
 */
export interface PondFeedingSource {
	pondId: string;
	pondName: string;
	deviceId: string | null;
	/** Real fish count, or null when the pond has none recorded. */
	population: number | null;
	feedingRatePct: number;
	feedsPerDay: number;
	scheduleStart: Date;
	scheduleEnd: Date;
	/** Effective daily ceiling in grams. */
	dailyCapG: number;
	hopperCapacityG: number | null;
	/** What the device will dispense; null when no feeder is paired. */
	gramsPerFeeding: number | null;
}

export async function resolvePondFeeding(pondId: string): Promise<PondFeedingSource | null> {
	const pond = await prisma.pond.findUnique({
		where: { id: pondId },
		select: {
			id: true,
			name: true,
			population: true,
			feedingRatePct: true,
			feedsPerDay: true,
			scheduleStart: true,
			scheduleEnd: true,
			energyDevices: {
				orderBy: { createdAt: "asc" },
				take: 1,
				select: {
					id: true,
					gramsPerFeeding: true,
					hopperCapacityG: true,
					dailyCapG: true,
				},
			},
		},
	});
	if (!pond) return null;

	const device = pond.energyDevices[0] ?? null;
	const [schedule, limits] = await Promise.all([
		resolveCurrentSchedule(pond.id, device?.id ?? null),
		getFeedingLimits(),
	]);

	const effective = schedule ?? {
		scheduleStart: pond.scheduleStart,
		scheduleEnd: pond.scheduleEnd,
		feedsPerDay: pond.feedsPerDay,
		feedingRatePct: pond.feedingRatePct,
	};

	return {
		pondId: pond.id,
		pondName: pond.name,
		deviceId: device?.id ?? null,
		population: typeof pond.population === "number" && pond.population > 0 ? pond.population : null,
		feedingRatePct: effective.feedingRatePct,
		feedsPerDay: effective.feedsPerDay,
		scheduleStart: effective.scheduleStart,
		scheduleEnd: effective.scheduleEnd,
		dailyCapG: resolveDailyCapG({
			configuredCapG: device?.dailyCapG,
			hopperCapacityG: device?.hopperCapacityG,
			dailyCapFactor: limits.dailyCapFactor,
		}),
		hopperCapacityG: device?.hopperCapacityG ?? null,
		gramsPerFeeding: device?.gramsPerFeeding ?? null,
	};
}
