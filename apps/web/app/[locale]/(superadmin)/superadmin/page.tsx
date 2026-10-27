import { Card, PageHeader, StatCard } from "@/components/superadmin/ui";
import { getSuperadminStats } from "@/lib/actions/superadmin";
import { Droplets, FolderTree, ShieldCheck, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function SuperadminOverviewPage() {
	const [stats, t] = await Promise.all([
		getSuperadminStats(),
		getTranslations("superadmin.overview"),
	]);

	return (
		<div className="space-y-8">
			<PageHeader title={t("title")} description={t("description")} />

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label={t("users")} value={stats.userCount} hint={t("usersHint")} icon={Users} />
				<StatCard
					label={t("organizations")}
					value={stats.orgCount}
					hint={t("organizationsHint")}
					icon={FolderTree}
				/>
				<StatCard
					label={t("ponds")}
					value={stats.pondCount}
					hint={t("pondsHint")}
					icon={Droplets}
				/>
				<StatCard
					label={t("platformAdmins")}
					value={stats.activePlatformAdminCount}
					hint={t("grantsTotal", { count: stats.platformAdminCount })}
					icon={ShieldCheck}
				/>
			</div>

			<Card className="space-y-3 p-6">
				<h2 className="text-lg font-black text-[#0A3D62]">{t("scopeTitle")}</h2>
				<ul className="list-disc space-y-1.5 pl-5 text-sm text-[#3D5568]">
					<li>{t("scope1")}</li>
					<li>{t("scope2")}</li>
					<li>{t("scope3")}</li>
					<li>{t("scope4")}</li>
				</ul>
			</Card>
		</div>
	);
}
