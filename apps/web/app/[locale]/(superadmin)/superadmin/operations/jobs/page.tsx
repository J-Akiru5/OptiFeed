import { OpsNav } from "@/components/superadmin/ops-nav";
import { Badge, Card, EmptyState, PageHeader, TableFrame } from "@/components/superadmin/ui";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatFarmDateTime } from "@/lib/date-local";
import { JOB_MAX_ATTEMPTS, getJobMetrics } from "@/lib/jobs/service";
import { listDeadLetterJobs } from "@/lib/platform/dead-letter-jobs";
import { Skull } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Operations → Background jobs (issue #590).
 *
 * The dead-letter list: jobs that exhausted their attempts, with the operator
 * error, the farm they belong to and how many attempts they took. Queue depth
 * sits above it so a growing backlog is visible next to the failures.
 */
export default async function OperationsJobsPage() {
	await requirePlatformAdmin();

	const [jobs, metrics, t, tDates] = await Promise.all([
		listDeadLetterJobs(),
		getJobMetrics(),
		getTranslations("superadmin.operations.jobs"),
		getTranslations("dates"),
	]);

	const formatted = (iso: string) => formatFarmDateTime(new Date(iso), tDates).full;

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />
			<OpsNav />

			<p className="text-sm font-bold text-[#3D5568] dark:text-slate-400">
				{t("summary", {
					queued: metrics.queued,
					running: metrics.running,
					failed: metrics.failed24h,
				})}
			</p>

			{jobs.length === 0 ? (
				<Card>
					<EmptyState
						icon={Skull}
						title={t("noFailuresTitle")}
						description={t("noFailuresDescription")}
					/>
				</Card>
			) : (
				<TableFrame
					label={t("failuresCaption")}
					minWidth="min-w-[52rem]"
					columns={[
						{ key: "finished", label: t("columnFinished") },
						{ key: "type", label: t("columnType") },
						{ key: "owner", label: t("columnOwner") },
						{ key: "attempts", label: t("columnAttempts") },
						{ key: "error", label: t("columnError") },
					]}
				>
					{jobs.map((job) => (
						<tr
							key={job.id}
							className="border-b border-gray-50 align-top last:border-0 hover:bg-[#F4F7F6] dark:border-[#1B2740] dark:hover:bg-[#162238]/60"
						>
							<td className="px-6 py-3 whitespace-nowrap text-xs text-[#3D5568] dark:text-slate-400">
								{job.finishedAt ? formatted(job.finishedAt) : "—"}
							</td>
							<td className="px-6 py-3">
								<Badge tone="neutral">{job.type}</Badge>
							</td>
							<td className="px-6 py-3 font-mono text-[11px] break-all text-[#3D5568] dark:text-slate-400">
								{job.ownerId}
							</td>
							<td className="px-6 py-3">
								<Badge tone={job.attempts >= JOB_MAX_ATTEMPTS ? "danger" : "neutral"}>
									{job.attempts}
								</Badge>
							</td>
							<td className="px-6 py-3">
								<p
									title={job.lastError ?? undefined}
									className="line-clamp-2 max-w-[32rem] text-xs font-bold break-words text-[#0A3D62] dark:text-slate-100"
								>
									{job.lastError ?? t("columnError")}
								</p>
							</td>
						</tr>
					))}
				</TableFrame>
			)}
		</div>
	);
}
