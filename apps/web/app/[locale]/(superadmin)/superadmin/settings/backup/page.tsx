import { BackupExportForm } from "@/components/backup/backup-export-form";
import { BackupHistory } from "@/components/backup/backup-history";
import { LastExport } from "@/components/backup/backup-last-export";
import { Alert, Card, PageHeader, SectionTitle } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { listBackupExports } from "@/lib/backup/audit";
import { BACKUP_EXPORT_MAX_BYTES, BACKUP_EXPORT_MAX_ROWS } from "@/lib/backup/constants";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Platform Backup page (issue #353).
 *
 * The full-database export: platform admin, fresh step-up, a mandatory reason
 * and the per-user rate limit. The list below it shows every export attempt on
 * the platform — tenant exports included — so oversight does not depend on the
 * tenant's own page.
 */
export default async function SuperadminBackupPage() {
	const [t, tSettings, user] = await Promise.all([
		getTranslations("superadmin.backup"),
		getTranslations("superadmin.settings"),
		getCurrentUser(),
	]);

	const records = user ? await listBackupExports({ orgIds: null, actorUserId: user.id }) : [];

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
					href="/superadmin/settings"
					className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 px-1 text-xs font-bold text-[#0A3D62] hover:underline"
				>
					<ChevronLeft aria-hidden="true" className="h-4 w-4" /> {tSettings("title")}
				</Link>
				<PageHeader title={t("title")} description={t("description")} />
			</div>

			<Alert tone="warning">
				<strong className="block font-black uppercase tracking-wider">{t("warningTitle")}</strong>
				<span className="mt-1 block leading-relaxed">{t("warningBody")}</span>
			</Alert>

			<Card>
				<SectionTitle title={t("exportTitle")} description={t("exportBody")} />
				<div className="space-y-4 p-5">
					<p className="text-sm text-[#3D5568]">
						<span className="font-black text-[#0A3D62]">{t("scopeLabel")}</span>{" "}
						{t("scopePlatform")}
					</p>
					<BackupExportForm
						endpoint="/api/superadmin/backup/export"
						namespace="superadmin.backup"
						appearance="light"
						requiresReason
						requiresStepUp
						rowLimit={BACKUP_EXPORT_MAX_ROWS}
						sizeLimitMb={Math.floor(BACKUP_EXPORT_MAX_BYTES / (1024 * 1024))}
					/>
					<p className="text-[11px] text-[#3D5568]">{t("verifyHint")}</p>
				</div>
			</Card>

			<Card>
				<SectionTitle title={t("lastExportTitle")} description={t("lastExportDesc")} />
				<div className="p-5">
					<LastExport
						record={records[0]}
						labels={labels}
						empty={t("noExport")}
						scopeLabel={(record) =>
							record.scope === "platform"
								? t("scopePlatform")
								: record.orgNames.join(", ") || t("scopeEmpty")
						}
					/>
				</div>
			</Card>

			<section aria-labelledby="backup-history-title" className="space-y-3">
				<div className="min-w-0">
					<h2 id="backup-history-title" className="text-lg font-black text-[#0A3D62]">
						{t("historyTitle")}
					</h2>
					<p className="mt-1 text-sm text-[#3D5568]">{t("historyDesc")}</p>
				</div>
				<BackupHistory records={records} labels={labels} />
			</section>
		</div>
	);
}
