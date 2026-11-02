import { OpsNav } from "@/components/superadmin/ops-nav";
import { ResolveReportButton } from "@/components/superadmin/resolve-report-button";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	PageHeader,
	TableFrame,
} from "@/components/superadmin/ui";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatFarmDateTime } from "@/lib/date-local";
import { type IssueReportRow, listIssueReports } from "@/lib/platform/issue-reports";
import { MessageSquareWarning } from "lucide-react";
import { getTranslations } from "next-intl/server";

const STATUS_TONE: Record<IssueReportRow["status"], BadgeTone> = {
	OPEN: "danger",
	RESOLVED: "success",
};

/**
 * Operations → issue reports (issue #487).
 *
 * Triage queue for reports submitted from the public site and by the
 * assistant. Newest first, bounded by the loader; a platform admin can mark an
 * open report resolved, which is audited in `resolveIssueReport`. The page is
 * gated here and the action repeats the gate so neither layer is load-bearing
 * on its own.
 */
export default async function OperationsReportsPage() {
	await requirePlatformAdmin();

	const [reports, t, tDates] = await Promise.all([
		listIssueReports(),
		getTranslations("superadmin.operations.reports"),
		getTranslations("dates"),
	]);

	const openCount = reports.filter((report) => report.status === "OPEN").length;
	const formatted = (iso: string) => formatFarmDateTime(new Date(iso), tDates).full;

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />
			<OpsNav />

			<p className="text-sm font-bold text-[#3D5568] dark:text-slate-400">
				{t("summary", { open: openCount, total: reports.length })}
			</p>

			{reports.length === 0 ? (
				<Card>
					<EmptyState icon={MessageSquareWarning} title={t("emptyTitle")} />
				</Card>
			) : (
				<TableFrame
					label={t("caption")}
					minWidth="min-w-[52rem]"
					columns={[
						{ key: "received", label: t("columns.received") },
						{ key: "category", label: t("columns.category") },
						{ key: "report", label: t("columns.report") },
						{ key: "source", label: t("columns.source") },
						{ key: "status", label: t("columns.status") },
					]}
				>
					{reports.map((report) => (
						<tr
							key={report.id}
							className="border-b border-gray-50 align-top last:border-0 hover:bg-[#F4F7F6] dark:border-[#1B2740] dark:hover:bg-[#162238]/60"
						>
							<td className="px-6 py-3 whitespace-nowrap text-xs text-[#3D5568] dark:text-slate-400">
								{formatted(report.createdAt)}
							</td>
							<td className="px-6 py-3">
								<Badge tone="neutral">{t(`categories.${report.category}`)}</Badge>
							</td>
							<td className="px-6 py-3">
								<p className="line-clamp-2 max-w-[32rem] text-sm font-bold break-words text-[#0A3D62] dark:text-slate-100">
									{report.message}
								</p>
								{report.pagePath && (
									<p className="mt-1 font-mono text-[11px] break-all text-[#3D5568] dark:text-slate-400">
										{report.pagePath}
									</p>
								)}
							</td>
							<td className="px-6 py-3">
								<Badge tone="neutral">{t(`sources.${report.source}`)}</Badge>
							</td>
							<td className="px-6 py-3">
								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={STATUS_TONE[report.status]}>{t(`statuses.${report.status}`)}</Badge>
									{report.status === "OPEN" ? (
										<ResolveReportButton id={report.id} />
									) : report.resolvedAt ? (
										<span className="text-[11px] font-bold text-[#3D5568] dark:text-slate-400">
											{t("resolvedAt", { when: formatted(report.resolvedAt) })}
										</span>
									) : null}
								</div>
							</td>
						</tr>
					))}
				</TableFrame>
			)}
		</div>
	);
}
