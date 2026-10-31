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
import { Link } from "@/i18n/routing";
import { listTenantMembers } from "@/lib/actions/admin";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { hasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/pagination";
import { ORG_SETTINGS_DEFAULTS, getOrgSettings } from "@/lib/settings/org";
import { DatabaseBackup, Settings } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AdminSettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [membersPage, canManageMembers, canManageSettings, scope, t, tCommon, tMembers, tBackup] =
		await Promise.all([
			listTenantMembers({ page }),
			hasPermission("manage_members"),
			hasPermission("manage_farms_ponds"),
			resolveOrgScope(),
			getTranslations("dashboard.adminSettings"),
			getTranslations("dashboard.adminCommon"),
			getTranslations("dashboard.adminMembers"),
			getTranslations("dashboard.adminBackup"),
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

			<AdminSection id="backup" title={tBackup("title")} description={tBackup("settingsBody")}>
				<div
					className={`${adminSurface} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6`}
				>
					<div className="flex min-w-0 items-start gap-3">
						<DatabaseBackup
							aria-hidden="true"
							className="mt-0.5 h-5 w-5 shrink-0 text-[#0A3D62] dark:text-[#8fc0ea]"
						/>
						<p className="min-w-0 text-sm text-[#3D5568] dark:text-gray-300">
							{tBackup("settingsDesc")}
						</p>
					</div>
					<Link
						href="/admin/settings/backup"
						className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62]"
					>
						{tBackup("open")}
					</Link>
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
