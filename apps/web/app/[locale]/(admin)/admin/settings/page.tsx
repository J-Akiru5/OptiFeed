import { adminFieldGrid, adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSection } from "@/components/admin/admin-section";
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
	const [membersPage, canManageMembers, canManageSettings, scope, t, tCommon, tMembers] =
		await Promise.all([
			listTenantMembers({ page }),
			hasPermission("manage_members"),
			hasPermission("manage_farms_ponds"),
			resolveOrgScope(),
			getTranslations("dashboard.adminSettings"),
			getTranslations("dashboard.adminCommon"),
			getTranslations("dashboard.adminMembers"),
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

			<AdminSection id="general-settings" title={t("generalTitle")} description={t("generalDesc")}>
				{!orgId && (
					<p
						role="note"
						className="rounded-xl border border-[#B54708]/30 bg-amber-50 px-4 py-3 text-xs font-bold text-[#B54708] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
					>
						{t("noOrg")}
					</p>
				)}

				<div className={adminFieldGrid}>
					<DefaultFeedingRateForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
					<NotificationSettingsForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
					<DeviceRegistrationForm orgId={orgId ?? ""} settings={settings} canManage={canEdit} />
				</div>
			</AdminSection>

			<AdminSection
				id="members"
				title={tMembers("membersTitle")}
				description={tMembers("membersDesc", { count: membersPage.total })}
			>
				<div className={`${adminSurface} overflow-hidden`}>
					<div className="p-4 sm:p-6">
						<MembersSettings
							members={members}
							canManage={canManageMembers}
							orgOptions={membersPage.orgOptions}
						/>
						{membersPage.total > 0 && (
							// Bleed the pager to the card edges so its top border spans the card
							// instead of stopping at the inner padding.
							<div className="-mx-4 -mb-4 mt-4 sm:-mx-6 sm:-mb-6">
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
							</div>
						)}
					</div>
				</div>
			</AdminSection>
		</div>
	);
}
