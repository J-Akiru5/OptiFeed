import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSection } from "@/components/admin/admin-section";
import { BackupExportForm } from "@/components/backup/backup-export-form";
import { BackupHistory } from "@/components/backup/backup-history";
import { LastExport } from "@/components/backup/backup-last-export";
import { Link } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { listBackupExports } from "@/lib/backup/audit";
import { BACKUP_EXPORT_MAX_BYTES, BACKUP_EXPORT_MAX_ROWS } from "@/lib/backup/constants";
import { isEmptyTenantScope, resolveTenantExportScope } from "@/lib/backup/scope";
import { cn } from "@/lib/utils";
import { ChevronLeft, DatabaseBackup, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Tenant Backup page (issue #353).
 *
 * One export control, the most recent result and the full history. The page is
 * inside the (admin) layout, so `requireTenantAdmin()` has already run; the
 * scope comes from the same `resolveOrgScope()` chain as the rest of the
 * console, and an operator without an active organization sees why rather than
 * a control that would be refused.
 */
export default async function AdminBackupPage() {
	const [t, user, scope] = await Promise.all([
		getTranslations("dashboard.adminBackup"),
		getCurrentUser(),
		resolveTenantExportScope(),
	]);

	const emptyScope = isEmptyTenantScope(scope);
	const records =
		user && !emptyScope
			? await listBackupExports({ orgIds: scope.orgIds, actorUserId: user.id })
			: [];

	const labels = {
		caption: t("historyCaption"),
		when: t("columnWhen"),
		who: t("columnWho"),
		scope: t("columnScope"),
		outcome: t("columnOutcome"),
		rows: t("columnRows"),
		size: t("columnSize"),
		checksum: t("columnChecksum"),
		reason: t("columnReason"),
		empty: t("historyEmpty"),
		platformScope: t("scopePlatform"),
		tenantScopeFallback: t("scopeEmpty"),
		outcomes: {
			succeeded: t("outcomeSucceeded"),
			failed: t("outcomeFailed"),
			cancelled: t("outcomeCancelled"),
		},
	};

	return (
		<div className="space-y-6">
			<div>
				<Link
					href="/admin/settings"
					className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 px-1 text-xs font-bold text-[#0A3D62] hover:underline dark:text-[#8fc0ea]"
				>
					<ChevronLeft aria-hidden="true" className="h-4 w-4" /> {t("backToSettings")}
				</Link>
				<AdminPageHeader icon={DatabaseBackup} title={t("title")} description={t("description")} />
			</div>

			<div
				role="note"
				className="flex items-start gap-3 rounded-2xl border border-[#B54708]/30 bg-amber-50 px-4 py-4 text-[#B54708] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
			>
				<ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
				<div className="min-w-0">
					<p className="text-xs font-black uppercase tracking-wider">{t("warningTitle")}</p>
					<p className="mt-1 text-xs leading-relaxed">{t("warningBody")}</p>
				</div>
			</div>

			<AdminSection id="backup-export" title={t("exportTitle")} description={t("exportBody")}>
				<div className={cn(adminSurface, "space-y-4 p-4 sm:p-6")}>
					<p className="text-sm text-[#3D5568] dark:text-gray-300">
						<span className="font-black text-[#0A3D62] dark:text-[#8fc0ea]">{t("scopeLabel")}</span>{" "}
						{emptyScope ? t("scopeEmpty") : scope.orgNames.join(", ")}
					</p>

					{emptyScope ? (
						<p className="rounded-xl border border-[#B54708]/30 bg-amber-50 px-4 py-3 text-xs font-bold text-[#B54708] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
							{t("noScope")}
						</p>
					) : (
						<BackupExportForm
							endpoint="/api/admin/backup/export"
							namespace="dashboard.adminBackup"
							requiresReason={false}
							requiresStepUp={false}
							rowLimit={BACKUP_EXPORT_MAX_ROWS}
							sizeLimitMb={Math.floor(BACKUP_EXPORT_MAX_BYTES / (1024 * 1024))}
						/>
					)}

					<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("verifyHint")}</p>
				</div>
			</AdminSection>

			<AdminSection id="backup-last" title={t("lastExportTitle")} description={t("lastExportDesc")}>
				<div className={cn(adminSurface, "p-4 sm:p-6")}>
					<LastExport
						record={records[0]}
						labels={labels}
						empty={t("noExport")}
						variant="admin"
						scopeLabel={(record) => record.orgNames.join(", ") || t("scopeEmpty")}
					/>
				</div>
			</AdminSection>

			<AdminSection id="backup-history" title={t("historyTitle")} description={t("historyDesc")}>
				<BackupHistory records={records} labels={labels} variant="admin" />
			</AdminSection>
		</div>
	);
}
