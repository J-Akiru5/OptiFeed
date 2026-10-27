import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MembersSettings } from "@/components/admin/members-settings";
import { Pagination } from "@/components/ui/pagination";
import { listTenantMembers } from "@/lib/actions/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/pagination";
import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminSettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [membersPage, canManage, t, tCommon] = await Promise.all([
		listTenantMembers({ page }),
		hasPermission("manage_members"),
		getTranslations("dashboard.adminSettings"),
		getTranslations("dashboard.adminCommon"),
	]);
	const members = membersPage.rows;
	const pageCount = Math.max(1, Math.ceil(membersPage.total / membersPage.pageSize));
	const firstRow = membersPage.total === 0 ? 0 : (membersPage.page - 1) * membersPage.pageSize + 1;
	const lastRow = Math.min(membersPage.page * membersPage.pageSize, membersPage.total);

	const planned = [
		{
			title: t("defaultFeedingRateTitle"),
			description: t("defaultFeedingRateDesc"),
		},
		{
			title: t("notificationsTitle"),
			description: t("notificationsDesc"),
		},
		{
			title: t("deviceRegistrationTitle"),
			description: t("deviceRegistrationDesc"),
		},
	];

	return (
		<div className="space-y-6">
			<AdminPageHeader icon={Settings} title={t("title")} description={t("desc")} />

			<section aria-label={t("generalTitle")} className={`${adminSurface} p-6`}>
				<MembersSettings
					members={members}
					canManage={canManage}
					orgOptions={membersPage.orgOptions}
				/>
				{membersPage.total > 0 && (
					<Pagination
						basePath="/admin/settings"
						page={membersPage.page}
						pageCount={pageCount}
						showing={tCommon("pagination.showing", {
							from: firstRow,
							to: lastRow,
							total: membersPage.total,
						})}
						previousLabel={tCommon("pagination.previous")}
						nextLabel={tCommon("pagination.next")}
						label={tCommon("pagination.label")}
					/>
				)}
			</section>

			<section className={`${adminSurface} p-6`}>
				<div className="mb-6 flex items-center gap-3">
					<span
						aria-hidden="true"
						className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0A3D62]/10 dark:bg-white/10"
					>
						<Settings className="h-5 w-5 text-[#0A3D62] dark:text-[#8fc0ea]" />
					</span>
					<div>
						<h2 className="font-black text-[#0A3D62] dark:text-[#8fc0ea]">{t("generalTitle")}</h2>
						<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("comingSoon")}</p>
					</div>
				</div>

				<ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{planned.map((item) => (
						<li
							key={item.title}
							className="rounded-xl border border-gray-200 bg-[#F4F7F6] p-4 dark:border-gray-700/60 dark:bg-gray-800/60"
						>
							<p className="mb-2 text-xs font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-300">
								{item.title}
							</p>
							<p className="text-sm text-[#0A3D62] dark:text-gray-200">{item.description}</p>
							<p className="mt-2 text-xs text-[#3D5568] italic dark:text-gray-400">
								{t("comingSoonNote")}
							</p>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
