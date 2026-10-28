import { AdminStatsCards } from "@/components/admin-stats-cards";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminOverviewCharts } from "@/components/admin/overview-charts";
import { RecentActivityTable } from "@/components/recent-activity-table";
import { getAdminStats } from "@/lib/actions/admin";
import { getAdminOverview } from "@/lib/actions/admin-overview";
import { formatDateTimeLocal } from "@/lib/date-local";
import { LayoutDashboard } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminOverviewPage() {
	const [stats, overview, t, tAudit, tCommon, tDates] = await Promise.all([
		getAdminStats(),
		getAdminOverview(),
		getTranslations("dashboard.adminOverview"),
		// The recent-activity table shows the same device event keys as the audit
		// log, so it borrows the same catalogue instead of printing them raw.
		getTranslations("dashboard.audit"),
		getTranslations("dashboard.common"),
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

			<section aria-labelledby="admin-overview-charts" className="space-y-4">
				<h2
					id="admin-overview-charts"
					className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]"
				>
					{t("chartsHeading")}
				</h2>
				{(overview.feedTruncated || overview.activityTruncated) && (
					<p className="text-xs font-semibold text-[#3D5568] dark:text-gray-400">
						{t("chartTruncatedNote")}
					</p>
				)}
				<AdminOverviewCharts
					feedStack={overview.feedStack}
					activityPoints={overview.activityPoints}
					deviceHealth={overview.deviceHealth}
					labels={{
						feedTitle: t("chartFeedTitle"),
						feedSummary: overview.feedTruncated
							? t("chartFeedSummaryTruncated", {
									days: overview.feedDays,
									total: Math.round(overview.feedTotalGrams),
								})
							: t("chartFeedSummary", {
									days: overview.feedDays,
									total: Math.round(overview.feedTotalGrams),
								}),
						activityTitle: t("chartActivityTitle"),
						activitySummary: overview.activityTruncated
							? t("chartActivitySummaryTruncated", {
									days: overview.activityDays,
									total: overview.activityTotal,
								})
							: t("chartActivitySummary", {
									days: overview.activityDays,
									total: overview.activityTotal,
								}),
						healthTitle: t("chartHealthTitle"),
						healthSummary: t("chartHealthSummary", {
							online: overview.deviceHealth.online,
							offline: overview.deviceHealth.offline,
							total: overview.deviceHealth.total,
						}),
						online: t("chartOnline"),
						offline: t("chartOffline"),
						pending: t("chartPending"),
						sources: {
							scheduled: t("chartSourceScheduled"),
							dashboard: t("chartSourceDashboard"),
							button: t("chartSourceButton"),
							hand_fed: t("chartSourceHandFed"),
							unknown: t("chartSourceUnknown"),
						},
						chart: {
							period: tCommon("charts.period"),
							value: tCommon("charts.value"),
							name: tCommon("charts.name"),
							empty: tCommon("charts.empty"),
						},
					}}
				/>
			</section>

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
