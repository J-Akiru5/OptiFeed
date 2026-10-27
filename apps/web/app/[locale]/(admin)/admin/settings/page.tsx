import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MembersSettings } from "@/components/admin/members-settings";
import {
	DefaultFeedingRateForm,
	DeviceRegistrationForm,
	NotificationSettingsForm,
} from "@/components/admin/org-settings-forms";
import { Pagination } from "@/components/ui/pagination";
import { listTenantMembers } from "@/lib/actions/admin";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { hasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/pagination";
import { ORG_SETTINGS_DEFAULTS, getOrgSettings } from "@/lib/settings/org";
import { Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminSettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [membersPage, canManageMembers, canManageSettings, scope, t, tCommon] = await Promise.all([
		listTenantMembers({ page }),
		hasPermission("manage_members"),
		hasPermission("manage_farms_ponds"),
		resolveOrgScope(),
		getTranslations("dashboard.adminSettings"),
		getTranslations("dashboard.adminCommon"),
	]);
	const members = membersPage.rows;
	const pageCount = Math.max(1, Math.ceil(membersPage.total / membersPage.pageSize));
	const firstRow = membersPage.total === 0 ? 0 : (membersPage.page - 1) * membersPage.pageSize + 1;
	const lastRow = Math.min(membersPage.page * membersPage.pageSize, membersPage.total);

	const orgId = scope.orgIds[0] ?? null;
	const settings = orgId ? await getOrgSettings(orgId) : ORG_SETTINGS_DEFAULTS;
	const canEdit = canManageSettings && orgId !== null;

	return (
		<div className="space-y-6">
			<AdminPageHeader icon={Settings} title={t("title")} description={t("desc")} />

			<section aria-label={t("generalTitle")} className={`${adminSurface} p-6`}>
				<MembersSettings
					members={members}
					canManage={canManageMembers}
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

			<section aria-label={t("generalTitle")} className="space-y-4">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
						{t("generalTitle")}
					</h2>
					<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">{t("generalDesc")}</p>
					{!orgId && (
						<p className="mt-1 text-xs font-bold text-[#B54708] dark:text-amber-300">
							{t("noOrg")}
						</p>
					)}
				</div>

				<div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
					<DefaultFeedingRateForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
					<NotificationSettingsForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
					<DeviceRegistrationForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
				</div>
			</section>
		</div>
	);
}
