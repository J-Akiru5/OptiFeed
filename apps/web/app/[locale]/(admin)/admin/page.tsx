import { AdminStatsCards } from "@/components/admin-stats-cards";
import { RecentActivityTable } from "@/components/recent-activity-table";
import { getAdminStats } from "@/lib/actions/admin";

export default async function AdminOverviewPage() {
	const stats = await getAdminStats();

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Admin Overview</h1>
				<p className="text-sm text-[#3D5568] mt-1">System-wide statistics and recent activity.</p>
			</div>

			<AdminStatsCards
				userCount={stats.userCount}
				pondCount={stats.pondCount}
				deviceCount={stats.deviceCount}
			/>

			<div>
				<h2 className="text-lg font-black text-[#0A3D62] mb-4">Recent Activity</h2>
				<RecentActivityTable events={stats.recentEvents} />
			</div>
		</div>
	);
}
