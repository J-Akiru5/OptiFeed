import { ScheduleControls } from "@/components/ScheduleControls";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { StuckRequestBanner } from "@/components/StuckRequestBanner";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

function fmtTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export default async function SchedulePage() {
	const t = await getTranslations("dashboard.schedule");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		include: { devices: true },
	});

	if (!pond || !pond.devices.length) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{t("noPondData")}</p>
			</div>
		);
	}

	const device = pond.devices[0];

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true, lastSeenAt: true },
	});

	if (!energyDevice) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{t("noPondData")}</p>
			</div>
		);
	}

	const [latestAppliedCommand, pendingCommands, stuckFeedRequests, stuckScheduleCommands] =
		await Promise.all([
			prisma.scheduleCommand.findFirst({
				where: { deviceId: energyDevice.id, status: "applied" },
				orderBy: { appliedAt: "desc" },
			}),
			prisma.scheduleCommand.findMany({
				where: { deviceId: energyDevice.id, status: { in: ["pending", "sent"] } },
				orderBy: { createdAt: "desc" },
				take: 1,
			}),
			// Stuck dispatched feed requests — picked up by device but never confirmed
			prisma.feedRequest.findMany({
				where: {
					deviceId: energyDevice.id,
					status: "dispatched",
					updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
				},
				orderBy: { createdAt: "asc" },
				take: 10,
				select: { id: true, grams: true, createdAt: true },
			}),
			// Stuck sent schedule commands — picked up by device but never acked
			prisma.scheduleCommand.findMany({
				where: {
					deviceId: energyDevice.id,
					status: "sent",
					updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
				},
				orderBy: { createdAt: "asc" },
				take: 5,
				select: { id: true, createdAt: true },
			}),
		]);

	const pendingCommand = pendingCommands.length > 0 ? pendingCommands[0] : null;

	const deviceOffline =
		!energyDevice.lastSeenAt ||
		Date.now() - energyDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;

	const serializeCommand = (cmd: typeof latestAppliedCommand) => {
		if (!cmd) return null;
		return {
			id: cmd.id,
			status: cmd.status,
			scheduleStart: fmtTime(cmd.scheduleStart),
			scheduleEnd: fmtTime(cmd.scheduleEnd),
			feedsPerDay: cmd.feedsPerDay,
			feedingRatePct: cmd.feedingRatePct,
			appliedAt: cmd.appliedAt?.toISOString() ?? null,
			deviceTime: cmd.deviceTime,
		};
	};

	return (
		<div className="space-y-8 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold text-[var(--ofd-base)]">{t("title")}</h1>
				<p className="mt-2 text-gray-700">{t("desc")}</p>
			</div>

			<StuckRequestBanner
				stuckFeedRequests={stuckFeedRequests.map((r) => ({
					id: r.id,
					grams: r.grams,
					createdAt: r.createdAt.toISOString(),
				}))}
				stuckScheduleCommands={stuckScheduleCommands.map((c) => ({
					id: c.id,
					createdAt: c.createdAt.toISOString(),
				}))}
				deviceOffline={deviceOffline}
				deviceLastSeenAt={energyDevice.lastSeenAt?.toISOString() ?? null}
				deviceId={energyDevice.id}
				pondId={pond.id}
				scheduleStart={fmtTime(pond.scheduleStart)}
				scheduleEnd={fmtTime(pond.scheduleEnd)}
				feedsPerDay={pond.feedsPerDay}
				feedingRatePct={pond.feedingRatePct}
			/>

			<ScheduleControls deviceId={energyDevice.id} initialIsPaused={device.isPaused} />

			<ScheduleEditor
				pondId={pond.id}
				deviceId={energyDevice.id}
				initialStart={fmtTime(pond.scheduleStart)}
				initialEnd={fmtTime(pond.scheduleEnd)}
				initialFeedsPerDay={pond.feedsPerDay}
				initialFeedingRatePct={pond.feedingRatePct}
				pendingCommand={serializeCommand(pendingCommand)}
				latestAppliedCommand={serializeCommand(latestAppliedCommand)}
			/>
		</div>
	);
}
