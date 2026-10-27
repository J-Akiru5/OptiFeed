import { DashboardEmptyState, ReadOnlyNotice } from "@/components/dashboard/dashboard-ui";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { hasPermission } from "@/lib/auth/permissions";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import { serialiseCycle } from "@/lib/crop-cycle/serialise";
import type { PondOption } from "@/lib/crop-cycle/types";
import type {
	CycleSummarySnapshot,
	HarvestEventSnapshot,
	HarvestSnapshotData,
} from "@/lib/offline/snapshots";
import { parsePondProfile } from "@/lib/pond-profile";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function HarvestPage() {
	const [tSchedule, tCommon] = await Promise.all([
		getTranslations("dashboard.schedule"),
		getTranslations("dashboard.common"),
	]);
	const pond = await getActivePond({ energyDevices: true });

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={CalendarDays}
					title={tSchedule("noPondData")}
					description={tCommon("noPondDesc")}
				/>
			</div>
		);
	}

	const [canManage, ponds, cycles, upcomingEvents] = await Promise.all([
		hasPermission("manage_crop_cycle"),
		prisma.pond.findMany({
			where: { ownerId: pond.ownerId, status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				name: true,
				isFallow: true,
				population: true,
				notificationPrefs: true,
			},
		}),
		prisma.cropCycle.findMany({
			where: { pond: { ownerId: pond.ownerId } },
			orderBy: { createdAt: "desc" },
			take: 30,
			select: {
				id: true,
				pondId: true,
				label: true,
				status: true,
				stockingDate: true,
				stockingCount: true,
				stockingAvgWeightG: true,
				growOutDays: true,
				targetHarvestDate: true,
				targetHarvestWeightG: true,
				expectedSurvivalPct: true,
				actualHarvestDate: true,
				actualHarvestWeightKg: true,
				actualHarvestCount: true,
				actualFcr: true,
				notes: true,
			},
		}),
		prisma.pondEvent.findMany({
			where: { pondId: pond.id, startsAt: { gte: new Date(`${todayDateOnly()}T00:00:00.000Z`) } },
			orderBy: { startsAt: "asc" },
			take: 20,
			select: { id: true, title: true, type: true, status: true, startsAt: true },
		}),
	]);

	const pondOptions: PondOption[] = ponds.map((item) => {
		const profile = parsePondProfile(item.notificationPrefs);
		return {
			id: item.id,
			name: item.name,
			isFallow: item.isFallow,
			population: item.population,
			areaM2: profile.areaM2,
			averageDepthM: profile.averageDepthM,
		};
	});
	const serialised = cycles.map(serialiseCycle);
	const activeCycles = serialised.filter((cycle) => cycle.status === "ACTIVE");
	const activeCycle = activeCycles.find((cycle) => cycle.pondId === pond.id) ?? null;
	const recentCycles = serialised.filter((cycle) => cycle.status !== "ACTIVE");
	const today = todayDateOnly();
	const devices = (pond.energyDevices ?? []) as Array<{
		feedLevelPercent: number | null;
		feedLevelUpdatedAt: Date | null;
		lastSeenAt: Date | null;
	}>;
	const latestDevice = devices.reduce<(typeof devices)[number] | null>(
		(latest, device) =>
			!latest || (device.lastSeenAt?.getTime() ?? 0) > (latest.lastSeenAt?.getTime() ?? 0)
				? device
				: latest,
		null,
	);
	const hopperLevelPct = latestDevice?.feedLevelPercent ?? null;
	const hopperFeedLevelUpdatedAt = latestDevice?.feedLevelUpdatedAt ?? null;
	const hopperIsOffline =
		!latestDevice?.lastSeenAt ||
		Date.now() - latestDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;

	const summariseCycle = (cycle: (typeof serialised)[number]): CycleSummarySnapshot => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: cycle.stockingDate,
				growOutDays: cycle.growOutDays,
				targetHarvestDate: cycle.targetHarvestDate,
				stockingCount: cycle.stockingCount,
				targetHarvestWeightG: cycle.targetHarvestWeightG,
				expectedSurvivalPct: cycle.expectedSurvivalPct,
			},
			today,
		);
		return {
			label: cycle.label,
			status: cycle.status,
			stockingDate: cycle.stockingDate,
			harvestDate: cycle.targetHarvestDate,
			stockingCount: cycle.stockingCount,
			targetWeightG: cycle.targetHarvestWeightG,
			growOutDay: metrics.growOutDay,
			daysToHarvest: metrics.daysToHarvest,
		};
	};

	const harvestSnapshot: HarvestSnapshotData = {
		pondName: pond.name,
		activeCycles: serialised
			.filter((cycle) => cycle.pondId === pond.id && cycle.status === "ACTIVE")
			.map(summariseCycle),
		recentCycles: serialised
			.filter((cycle) => cycle.pondId === pond.id && cycle.status !== "ACTIVE")
			.slice(0, 10)
			.map(summariseCycle),
		upcomingEvents: upcomingEvents.map<HarvestEventSnapshot>((event) => ({
			title: event.title,
			date: event.startsAt.toISOString().slice(0, 10),
			type: event.type,
			status: event.status,
		})),
	};

	return (
		<>
			<SnapshotWriter
				page="harvest"
				scope={pond.ownerId}
				pondId={pond.id}
				pondName={pond.name}
				data={harvestSnapshot}
			/>
			{!canManage && (
				<div className="mb-4">
					<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
				</div>
			)}
			<HarvestCalendar
				initialPondId={pond.id}
				initialPondName={pond.name}
				initialPondIsFallow={pond.isFallow}
				ponds={pondOptions}
				activeCycle={activeCycle}
				activeCycles={activeCycles}
				recentCycles={recentCycles}
				canManage={canManage}
				today={today}
				hopperLevelPct={hopperLevelPct}
				hopperFeedLevelUpdatedAt={hopperFeedLevelUpdatedAt?.toISOString() ?? null}
				hopperIsOffline={hopperIsOffline}
			/>
		</>
	);
}
