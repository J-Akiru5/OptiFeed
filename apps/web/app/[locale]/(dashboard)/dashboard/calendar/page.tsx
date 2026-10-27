import { DashboardEmptyState, DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { CalendarCapabilityBadge } from "@/components/harvest/calendar-controls";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { calendarCapability } from "@/lib/calendar/capability";
import { loadFarmerCalendarPageData } from "@/lib/calendar/farmer-page";
import { CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

/**
 * The farmer's dedicated Calendar page (E25, #212).
 *
 * `/dashboard/harvest` keeps the embedded grow-out calendar; this page adds a
 * nav entry and the org-wide read-only view. Writes remain limited to the
 * caller's own farm by the shared server actions.
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

	const [tPage, tCommon] = await Promise.all([
		getTranslations("dashboard.harvest.calendarPage"),
		getTranslations("dashboard.common"),
	]);
	const capability = calendarCapability({
		canManage: data.canManage,
		writablePondIds: data.writablePondIds,
		pondCount: data.ponds.length,
	});

	return (
		<div className="space-y-6">
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
			<HarvestCalendar {...data} apiScope="member-org" heading="calendar" showHeader={false} />
		</div>
	);
}
