import {
	DashboardEmptyState,
	DashboardPageHeader,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { CalendarCapabilityBadge } from "@/components/harvest/calendar-controls";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { SnapshotWriter } from "@/components/pwa/snapshot-writer";
import { calendarCapability } from "@/lib/calendar/capability";
import { loadUpcomingCalendarEvents } from "@/lib/calendar/event-sources";
import { loadFarmerCalendarPageData } from "@/lib/calendar/farmer-page";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import type {
	CycleSummarySnapshot,
	HarvestEventSnapshot,
	HarvestSnapshotData,
} from "@/lib/offline/snapshots";
import { CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

/**
 * The farmer's Calendar & Harvest page (#248).
 *
 * The dedicated Calendar page and the old Harvest & Grow-out page rendered the
 * same calendar component; keeping both duplicated the nav entry and let the
 * two pages compute "Upcoming events" differently. This page is the one
 * destination: the org-wide calendar plus the grow-out cycle, harvest planning
 * and projection panels, hopper card and offline Harvest snapshot.
 *
 * `/dashboard/harvest` redirects here with its query string intact.
 */
export default async function FarmerCalendarPage() {
	const data = await loadFarmerCalendarPageData();

	if (!data) {
		const [tSchedule, tCommon] = await Promise.all([
			getTranslations("dashboard.schedule"),
			getTranslations("dashboard.common"),
		]);

		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState
					icon={CalendarRange}
					title={tSchedule("noPondData")}
					description={tCommon("noPondDesc")}
				/>
			</div>
		);
	}

	const [{ events: upcomingEvents }, tPage, tCommon] = await Promise.all([
		loadUpcomingCalendarEvents({
			ponds: [data.initialCalendarPond],
			today: data.today,
		}),
		getTranslations("dashboard.harvest.calendarPage"),
		getTranslations("dashboard.common"),
	]);
	const capability = calendarCapability({
		canManage: data.canManage,
		writablePondIds: data.writablePondIds,
		pondCount: data.ponds.length,
	});

	const summariseCycle = (cycle: (typeof data.activeCycles)[number]): CycleSummarySnapshot => {
		const metrics = computeCropCycleMetrics(
			{
				stockingDate: cycle.stockingDate,
				growOutDays: cycle.growOutDays,
				targetHarvestDate: cycle.targetHarvestDate,
				stockingCount: cycle.stockingCount,
				targetHarvestWeightG: cycle.targetHarvestWeightG,
				expectedSurvivalPct: cycle.expectedSurvivalPct,
			},
			data.today,
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

	// One snapshot rule for the offline shell: the same pond, the same
	// upcoming list the rail shows. The `harvest` page key is kept so the
	// cached offline shell keeps reading its existing record.
	const harvestSnapshot: HarvestSnapshotData = {
		pondName: data.initialPondName,
		activeCycles: data.activeCycles
			.filter((cycle) => cycle.pondId === data.initialPondId)
			.map(summariseCycle),
		recentCycles: data.recentCycles
			.filter((cycle) => cycle.pondId === data.initialPondId)
			.slice(0, 10)
			.map(summariseCycle),
		upcomingEvents: upcomingEvents.map<HarvestEventSnapshot>((event) => ({
			title: event.title,
			date: event.start.slice(0, 10),
			type: event.type,
			status: event.status ?? "planned",
		})),
	};

	return (
		<div className="space-y-6">
			<SnapshotWriter
				page="harvest"
				scope={data.ownerId}
				pondId={data.initialPondId}
				pondName={data.initialPondName}
				data={harvestSnapshot}
			/>
			<DashboardPageHeader
				icon={CalendarRange}
				title={tPage("title")}
				description={tPage("desc")}
				actions={
					<CalendarCapabilityBadge
						capability={capability}
						labels={{
							edit: tCommon("capability.edit"),
							ownFarm: tCommon("capability.ownFarm"),
							read: tCommon("capability.read"),
						}}
					/>
				}
			/>
			{!data.canManage && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}
			<HarvestCalendar
				initialPondId={data.initialPondId}
				initialPondName={data.initialPondName}
				initialPondIsFallow={data.initialPondIsFallow}
				apiScope="member-org"
				writablePondIds={data.writablePondIds}
				ponds={data.ponds}
				activeCycle={data.activeCycle}
				activeCycles={data.activeCycles}
				recentCycles={data.recentCycles}
				canManage={data.canManage}
				showHeader={false}
				today={data.today}
				hopperLevelPct={data.hopperLevelPct}
				hopperFeedLevelUpdatedAt={data.hopperFeedLevelUpdatedAt}
				hopperIsOffline={data.hopperIsOffline}
			/>
		</div>
	);
}
