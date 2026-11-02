import { OpsNav } from "@/components/superadmin/ops-nav";
import {
	Badge,
	Card,
	EmptyState,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link, getPathname } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	type AuditFilters,
	getAuditFilterOptions,
	listPlatformAuditEntries,
	parseAuditFilters,
} from "@/lib/platform/audit-log";
import { Download, ScrollText, Search, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

function auditQueryString(filters: AuditFilters): string {
	const search = new URLSearchParams();
	if (filters.action) search.set("action", filters.action);
	if (filters.actor) search.set("actor", filters.actor);
	if (filters.orgId) search.set("org", filters.orgId);
	if (filters.targetType) search.set("targetType", filters.targetType);
	if (filters.target) search.set("target", filters.target);
	if (filters.from) search.set("from", filters.from);
	if (filters.to) search.set("to", filters.to);
	return search.toString();
}

const FIELD_CLASS =
	"w-full rounded-xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] px-3 py-2 text-sm text-[#0A3D62] dark:text-slate-100 transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A]";

/**
 * Operations → platform audit explorer (E16.4, task I-15).
 *
 * Filter by action, actor, organization, target type/id and date range, page
 * through the result with the shared numbered pagination, open one row for the
 * before/after JSON, or export the same filter as CSV (capped at 5000 rows).
 * Every read is platform-gated in the page and again in the data module.
 */
export default async function OperationsAuditPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	await requirePlatformAdmin();

	const params = await searchParams;
	const filters = parseAuditFilters(params);

	const [result, options, locale, t, tCommon, tDates] = await Promise.all([
		listPlatformAuditEntries(filters),
		getAuditFilterOptions(),
		getLocale(),
		getTranslations("superadmin.operations"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
	const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
	const lastRow = Math.min(result.page * result.pageSize, result.total);
	const exportsQuery = auditQueryString(filters);
	const exportHref = `/api/platform/audit/export${exportsQuery ? `?${exportsQuery}` : ""}`;
	const formAction = getPathname({ href: "/superadmin/operations/audit", locale });
	const hasFilters = Boolean(exportsQuery);

	const formatted = (date: Date) => formatDateTimeLocal(date, tDates).full;

	return (
		<div className="space-y-6">
			<PageHeader title={t("audit.title")} description={t("audit.description")} />
			<OpsNav />

			<Card className="p-5">
				<form action={formAction} method="get" className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<label className="block">
							<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
								{t("audit.filters.action")}
							</span>
							<input
								type="search"
								name="action"
								list="audit-actions"
								defaultValue={filters.action ?? ""}
								placeholder={t("audit.filters.actionPlaceholder")}
								className={`${FIELD_CLASS} mt-1`}
							/>
							<datalist id="audit-actions">
								{options.actions.map((action) => (
									<option key={action} value={action} />
								))}
							</datalist>
						</label>

						<label className="block">
							<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
								{t("audit.filters.actor")}
							</span>
							<input
								type="search"
								name="actor"
								defaultValue={filters.actor ?? ""}
								placeholder={t("audit.filters.actorPlaceholder")}
								className={`${FIELD_CLASS} mt-1`}
							/>
						</label>

						<label className="block">
							<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
								{t("audit.filters.org")}
							</span>
							<select
								name="org"
								defaultValue={filters.orgId ?? ""}
								className={`${FIELD_CLASS} mt-1`}
							>
								<option value="">{t("audit.filters.allOrgs")}</option>
								{options.orgs.map((org) => (
									<option key={org.id} value={org.id}>
										{org.name}
									</option>
								))}
							</select>
						</label>

						<label className="block">
							<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
								{t("audit.filters.targetType")}
							</span>
							<select
								name="targetType"
								defaultValue={filters.targetType ?? ""}
								className={`${FIELD_CLASS} mt-1`}
							>
								<option value="">{t("audit.filters.allTargetTypes")}</option>
								{options.targetTypes.map((type) => (
									<option key={type} value={type}>
										{type}
									</option>
								))}
							</select>
						</label>

						<label className="block">
							<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
								{t("audit.filters.target")}
							</span>
							<input
								type="search"
								name="target"
								defaultValue={filters.target ?? ""}
								placeholder={t("audit.filters.targetPlaceholder")}
								className={`${FIELD_CLASS} mt-1`}
							/>
						</label>

						<div className="grid grid-cols-2 gap-3">
							<label className="block">
								<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
									{t("audit.filters.from")}
								</span>
								<input
									type="date"
									name="from"
									defaultValue={filters.from ?? ""}
									className={`${FIELD_CLASS} mt-1`}
								/>
							</label>
							<label className="block">
								<span className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
									{t("audit.filters.to")}
								</span>
								<input
									type="date"
									name="to"
									defaultValue={filters.to ?? ""}
									className={`${FIELD_CLASS} mt-1`}
								/>
							</label>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<button type="submit" className={SECONDARY_BUTTON}>
							<Search className="h-3.5 w-3.5" aria-hidden="true" />
							{t("audit.apply")}
						</button>
						{hasFilters && (
							<Link href="/superadmin/operations/audit" className={SECONDARY_BUTTON}>
								{t("audit.clear")}
							</Link>
						)}
						<a href={exportHref} className={SECONDARY_BUTTON} download>
							<Download className="h-3.5 w-3.5" aria-hidden="true" />
							{t("audit.export")}
						</a>
					</div>
					<p className="text-[11px] text-[#3D5568] dark:text-slate-400">{t("audit.exportNote")}</p>
				</form>
			</Card>

			{result.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={ScrollText}
						title={t("audit.emptyTitle")}
						description={t("audit.emptyDescription")}
					/>
				</Card>
			) : (
				<ListView
					pageKey="superadmin-operations-audit"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<ItemCardGrid label={t("audit.caption")}>
						{result.rows.map((row) => (
							<MobileCard key={row.id}>
								<div className="flex items-start justify-between gap-2">
									<p className="text-xs text-[#3D5568] dark:text-slate-400">
										{formatted(row.createdAt)}
									</p>
									<Badge tone={row.stepUpAt ? "brand" : "neutral"} icon={ShieldCheck}>
										{row.stepUpAt ? t("audit.stepUp") : t("audit.noStepUp")}
									</Badge>
								</div>
								<p className="font-mono text-sm font-black break-words text-[#0A3D62] dark:text-slate-100">
									{row.action}
								</p>
								<p className="text-xs font-bold text-[#3D5568] dark:text-slate-400">
									{t("audit.by", { actor: row.actorLabel })}
									{row.actorFarmId ? ` · ${row.actorFarmId}` : ""}
								</p>
								<p className="text-xs text-[#3D5568] dark:text-slate-400">
									{row.targetType}
									{row.targetId ? ` · ${row.targetId}` : ""}
								</p>
								<p className="text-xs text-[#3D5568] dark:text-slate-400">
									{row.orgName ?? t("audit.noOrg")}
								</p>
								<p className="line-clamp-3 text-xs text-[#3D5568] dark:text-slate-400">
									{row.reason}
								</p>
								<Link href={`/superadmin/operations/audit/${row.id}`} className={SECONDARY_BUTTON}>
									{t("audit.openDetail")}
								</Link>
							</MobileCard>
						))}
					</ItemCardGrid>

					<TableFrame
						className="hidden md:block"
						label={t("audit.caption")}
						minWidth="min-w-[64rem]"
						columns={[
							{ key: "time", label: t("audit.columnTime") },
							{ key: "actor", label: t("audit.columnActor") },
							{ key: "action", label: t("audit.columnAction") },
							{ key: "target", label: t("audit.columnTarget") },
							{ key: "org", label: t("audit.columnOrg") },
							{ key: "reason", label: t("audit.columnReason") },
							{ key: "detail", label: t("audit.columnDetail") },
						]}
					>
						{result.rows.map((row) => (
							<tr
								key={row.id}
								className="border-b border-gray-50 dark:border-[#1B2740] align-top last:border-0 hover:bg-[#F4F7F6] dark:hover:bg-[#162238]/50 dark:hover:bg-[#162238]/60"
							>
								<td className="px-6 py-3 text-xs whitespace-nowrap text-[#3D5568] dark:text-slate-400">
									{formatted(row.createdAt)}
								</td>
								<td className="px-6 py-3 text-xs text-[#3D5568] dark:text-slate-400">
									<p className="font-bold text-[#0A3D62] dark:text-slate-100">{row.actorLabel}</p>
									{row.actorFarmId && <p className="text-[11px]">{row.actorFarmId}</p>}
								</td>
								<td className="px-6 py-3 font-mono text-xs font-black break-words text-[#0A3D62] dark:text-slate-100">
									{row.action}
								</td>
								<td className="px-6 py-3 text-xs text-[#3D5568] dark:text-slate-400">
									<p className="font-bold">{row.targetType}</p>
									{row.targetId && (
										<p className="font-mono text-[11px] break-all">{row.targetId}</p>
									)}
								</td>
								<td className="px-6 py-3 text-xs font-bold text-[#3D5568] dark:text-slate-400">
									{row.orgName ?? t("audit.noOrg")}
								</td>
								<td className="max-w-[18rem] px-6 py-3 text-xs break-words text-[#3D5568] dark:text-slate-400">
									{row.reason}
								</td>
								<td className="px-6 py-3">
									<Link
										href={`/superadmin/operations/audit/${row.id}`}
										className={SECONDARY_BUTTON}
									>
										{t("audit.openDetail")}
									</Link>
								</td>
							</tr>
						))}
					</TableFrame>
				</ListView>
			)}

			<Pagination
				basePath="/superadmin/operations/audit"
				params={{
					action: filters.action,
					actor: filters.actor,
					org: filters.orgId,
					targetType: filters.targetType,
					target: filters.target,
					from: filters.from,
					to: filters.to,
				}}
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
