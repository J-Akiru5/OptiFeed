import { AdminStatsCards } from "@/components/admin-stats-cards";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RecentActivityTable } from "@/components/recent-activity-table";
import { getAdminStats } from "@/lib/actions/admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { LayoutDashboard } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminOverviewPage() {
	const [stats, t, tAudit, tDates] = await Promise.all([
		getAdminStats(),
		getTranslations("dashboard.adminOverview"),
		// The recent-activity table shows the same device event keys as the audit
		// log, so it borrows the same catalogue instead of printing them raw.
		getTranslations("dashboard.audit"),
		getTranslations("dates"),
	]);

	const eventTypeLabel = (eventType: string) => {
		const key = `eventType_${eventType}`;
		return tAudit.has(key) ? tAudit(key) : eventType;
	};
	const sourceLabel = (source: string) => {
		const key = `source_${source}`;
		return tAudit.has(key) ? tAudit(key) : source;
	};

	return (
		<div className="space-y-6">
			<AdminPageHeader icon={LayoutDashboard} title={t("title")} description={t("desc")} />

			<AdminStatsCards
				userCount={stats.userCount}
				pondCount={stats.pondCount}
				deviceCount={stats.deviceCount}
				labels={{
					users: t("statUsers"),
					ponds: t("statPonds"),
					devices: t("statDevices"),
				}}
			/>

			<section aria-labelledby="admin-recent-activity" className="space-y-4">
				<h2
					id="admin-recent-activity"
					className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]"
				>
					{t("recentActivity")}
				</h2>
				<RecentActivityTable
					events={stats.recentEvents}
					formatDate={(date) => formatDateTimeLocal(date, tDates).full}
					formatEventType={eventTypeLabel}
					formatSource={sourceLabel}
					labels={{
						time: t("columnTime"),
						device: t("columnDevice"),
						event: t("columnEvent"),
						source: t("columnSource"),
						empty: t("recentEmpty"),
					}}
				/>
			</section>
		</div>
	);
}
