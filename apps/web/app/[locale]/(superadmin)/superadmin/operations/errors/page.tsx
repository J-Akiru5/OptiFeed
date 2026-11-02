import { OpsNav } from "@/components/superadmin/ops-nav";
import { ResolveErrorButton } from "@/components/superadmin/resolve-error-button";
import { Badge, type BadgeTone, Card, EmptyState, PageHeader } from "@/components/superadmin/ui";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { ERROR_EVENT_RETENTION_DAYS } from "@/lib/error-capture";
import { getPageCount } from "@/lib/pagination";
import {
	ERROR_EVENT_STATUSES,
	type ErrorEventStatus,
	listErrorEvents,
	parseErrorEventFilters,
} from "@/lib/platform/error-events";
import { ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";

const SEVERITY_TONE: Record<string, BadgeTone> = {
	ERROR: "danger",
	WARNING: "warning",
	INFO: "neutral",
};

function filterHref(status: ErrorEventStatus): string {
	return status === "unresolved"
		? "/superadmin/operations/errors"
		: `/superadmin/operations/errors?status=${status}`;
}

/**
 * Operations → captured errors (mission 2026-10-29e, I-64; owner decision E1).
 *
 * First-party error capture: one row per distinct error, newest activity first,
 * unresolved by default. A row opens its (already scrubbed) stack trace and can
 * be marked resolved; a recurrence reopens it. Gated twice: once here and once
 * in `listErrorEvents`, so no caller can read the table without an active
 * PlatformAdmin row.
 */
export default async function OperationsErrorsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	await requirePlatformAdmin();

	const params = await searchParams;
	const filters = parseErrorEventFilters(params);

	const [result, t, tCommon, tDates] = await Promise.all([
		listErrorEvents(filters),
		getTranslations("superadmin.operations.errors"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const pageCount = getPageCount(result.total, result.pageSize);
	const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
	const lastRow = Math.min(result.page * result.pageSize, result.total);
	const formatted = (date: Date) => formatDateTimeLocal(date, tDates).full;

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { days: ERROR_EVENT_RETENTION_DAYS })}
			/>
			<OpsNav />

			<nav aria-label={t("filtersLabel")} className="-mx-1 overflow-x-auto">
				<ul className="flex min-w-max items-center gap-1 px-1">
					{ERROR_EVENT_STATUSES.map((status) => {
						const isActive = filters.status === status;
						return (
							<li key={status}>
								<Link
									href={filterHref(status)}
									aria-current={isActive ? "page" : undefined}
									className={
										isActive
											? "inline-flex min-h-11 items-center rounded-xl bg-[#0A3D62] px-3.5 py-2 text-sm font-bold text-white shadow-sm"
											: "inline-flex min-h-11 items-center rounded-xl px-3.5 py-2 text-sm font-bold text-[#3D5568] dark:text-slate-400 transition-colors hover:bg-white dark:hover:bg-[#162238] hover:text-[#0A3D62]"
									}
								>
									{t(`status.${status}`)}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			{result.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={ScrollText}
						title={t("emptyTitle")}
						description={t("emptyDescription")}
					/>
				</Card>
			) : (
				<ul className="space-y-3" aria-label={t("caption")}>
					{result.rows.map((row) => (
						<li key={row.id}>
							<Card className="p-4 sm:p-5">
								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>
										{t(`severity.${row.severity}`)}
									</Badge>
									<span className="font-mono text-xs font-bold break-all text-[#3D5568] dark:text-slate-400">
										{row.route}
									</span>
									<span className="text-xs text-[#3D5568] dark:text-slate-400">
										{t("occurrences", { count: row.count })}
									</span>
									{row.resolved && (
										<Badge tone="success">
											{row.resolvedAt
												? t("resolvedAt", { when: formatted(row.resolvedAt) })
												: t("resolvedBadge")}
										</Badge>
									)}
								</div>

								<p className="mt-2 text-sm font-bold break-words text-[#0A3D62] dark:text-slate-100">
									{row.message}
								</p>

								<p className="mt-1 text-xs text-[#3D5568] dark:text-slate-400">
									{t("firstSeen", { when: formatted(row.firstSeenAt) })} ·{" "}
									{t("lastSeen", { when: formatted(row.lastSeenAt) })}
								</p>

								{row.stack && (
									<details className="mt-2">
										<summary className="inline-flex cursor-pointer items-center text-xs font-bold text-[#0A3D62] dark:text-slate-100">
											{t("showStack")}
										</summary>
										<pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-[#F4F7F6] dark:bg-[#0B1220] p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[#3D5568] dark:text-slate-400">
											{row.stack}
										</pre>
									</details>
								)}

								{!row.resolved && (
									<div className="mt-3">
										<ResolveErrorButton id={row.id} />
									</div>
								)}
							</Card>
						</li>
					))}
				</ul>
			)}

			<Pagination
				basePath="/superadmin/operations/errors"
				params={{ status: filters.status === "unresolved" ? undefined : filters.status }}
				page={result.page}
				pageCount={pageCount}
				showing={tCommon("pagination.showing", {
					from: firstRow,
					to: lastRow,
					total: result.total,
				})}
				previousLabel={tCommon("previous")}
				nextLabel={tCommon("next")}
				label={tCommon("pagination.label")}
			/>
		</div>
	);
}
