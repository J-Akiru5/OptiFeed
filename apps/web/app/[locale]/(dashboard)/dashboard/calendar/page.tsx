import { DashboardEmptyState } from "@/components/dashboard/dashboard-ui";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { loadFarmerCalendarPageData } from "@/lib/calendar/farmer-page";
import { CalendarDays } from "lucide-react";
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
					icon={CalendarDays}
					title={tSchedule("noPondData")}
					description={tCommon("noPondDesc")}
				/>
			</div>
		);
	}

	return <HarvestCalendar {...data} apiScope="member-org" heading="calendar" />;
}
