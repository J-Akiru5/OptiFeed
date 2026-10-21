import prisma from "@/lib/prisma";

export interface CurrentScheduleConfig {
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	feedingRatePct: number;
}

// Resolves the "current" schedule/feeding-rate configuration for display and
// editing. With a paired EnergyDevice, saves are queued as ScheduleCommands and
// only reach `Pond.*` when no device exists (see updatePondSettings), so `pond.*`
// alone goes stale. The newest pending/sent command wins so a just-saved value
// survives a reload before the device acks; otherwise fall back to the last
// applied command, then to the pond row (a never-configured device).
export async function resolveCurrentSchedule(
	pondId: string,
	deviceId: string | null,
): Promise<CurrentScheduleConfig | null> {
	const [pond, latestApplied, pending] = await Promise.all([
		prisma.pond.findUnique({
			where: { id: pondId },
			select: {
				scheduleStart: true,
				scheduleEnd: true,
				feedsPerDay: true,
				feedingRatePct: true,
			},
		}),
		deviceId
			? prisma.scheduleCommand.findFirst({
					where: { deviceId, status: "applied" },
					orderBy: { appliedAt: "desc" },
					select: {
						scheduleStart: true,
						scheduleEnd: true,
						feedsPerDay: true,
						feedingRatePct: true,
					},
				})
			: null,
		deviceId
			? prisma.scheduleCommand.findFirst({
					where: { deviceId, status: { in: ["pending", "sent"] } },
					orderBy: { createdAt: "desc" },
					select: {
						scheduleStart: true,
						scheduleEnd: true,
						feedsPerDay: true,
						feedingRatePct: true,
					},
				})
			: null,
	]);

	if (!pond) return null;

	const command = pending ?? latestApplied;
	if (command) {
		return {
			scheduleStart: command.scheduleStart,
			scheduleEnd: command.scheduleEnd,
			feedsPerDay: command.feedsPerDay,
			feedingRatePct: command.feedingRatePct,
		};
	}

	return {
		scheduleStart: pond.scheduleStart,
		scheduleEnd: pond.scheduleEnd,
		feedsPerDay: pond.feedsPerDay,
		feedingRatePct: pond.feedingRatePct,
	};
}
