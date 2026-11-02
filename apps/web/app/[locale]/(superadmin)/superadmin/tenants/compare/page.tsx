import {
	Alert,
	Badge,
	Card,
	EmptyState,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link, getPathname } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getOrgComparison } from "@/lib/platform/org-comparison";
import {
	COMPARISON_MAX_ORGS,
	COMPARISON_MIN_ORGS,
	type ComparisonMetricKey,
	formatComparisonValue,
} from "@/lib/platform/org-comparison-rules";
import type { BandState } from "@/lib/platform/status-band-rules";
import type { TenantHealthRow } from "@/lib/platform/tenant-health-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	GitCompareArrows,
	HelpCircle,
	type LucideIcon,
	OctagonAlert,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

/**
 * Per-organization comparison (issue #479, M3C.9).
 *
 * Two to four organizations side by side on the tenant table's own scale. The
 * state, the numbers and the ordering all come from `getTenantHealthDataset`, so
 * a tenant cannot read better here than it does in the table; only the "best on
 * this metric" marks are new, and they are per metric, never a composite score.
 *
 * Honest by construction: a value that was never reported stays "not reported"
 * (never zero, never best), an unknown tenant is called out as unmeasured rather
 * than displayed as fine, and a failed read renders an explicit error instead of
 * an empty comparison. Server-rendered, no client JavaScript, no polling.
 */

const TONE: Record<BandState, "success" | "warning" | "danger" | "neutral"> = {
	ok: "success",
	degraded: "warning",
	critical: "danger",
	unknown: "neutral",
};

const ICON: Record<BandState, LucideIcon> = {
	ok: CheckCircle2,
	degraded: AlertTriangle,
	critical: OctagonAlert,
	unknown: HelpCircle,
};

const CHECKBOX_CLASS =
	"h-4 w-4 shrink-0 rounded border-gray-300 text-[#0A3D62] focus:ring-2 focus:ring-[#E85A2A]";

export default async function TenantComparisonPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	await requirePlatformAdmin();

	const params = await searchParams;
	const [page, locale, t, tBands, tCommon, tDates] = await Promise.all([
		getOrgComparison(params.org),
		getLocale(),
		getTranslations("superadmin.compare"),
		getTranslations("superadmin.statusBands"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const formAction = getPathname({ href: "/superadmin/tenants/compare", locale });
	const { comparison, selection } = page;
	const selected = selection.selected;
	const hasComparison = selected.length >= COMPARISON_MIN_ORGS;
	const metricSummary = new Map(comparison.metrics.map((metric) => [metric.key, metric]));
	const isBest = (key: ComparisonMetricKey, orgId: string) =>
		metricSummary.get(key)?.bestOrgIds.includes(orgId) ?? false;

	const valueText = (row: TenantHealthRow, key: ComparisonMetricKey) => {
		const value = formatComparisonValue(row, key);
		if (value === null) return t("notReported");
		if (value instanceof Date) return formatDateTimeLocal(value, tDates).full;
		return new Intl.NumberFormat(locale).format(value);
	};

	const percentText = (row: TenantHealthRow) =>
		row.offlinePct === null
			? t("notReported")
			: `${new Intl.NumberFormat(locale).format(row.offlinePct)}%`;

	const columns = [
		{ key: "tenant", label: t("columnTenant") },
		{ key: "state", label: t("columnState") },
		{ key: "status", label: t("columnOrgStatus") },
		{ key: "members", label: t("columnMembers") },
		{ key: "ponds", label: t("columnPonds") },
		{ key: "devices", label: t("columnDevices") },
		{ key: "reporting", label: t("columnReporting") },
		{ key: "offline", label: t("columnOffline") },
		{ key: "heartbeat", label: t("columnHeartbeat") },
		{ key: "alerts", label: t("columnAlerts") },
	];

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={
					page.sourceError ? t("descriptionFailed") : t("description", { count: page.available })
				}
				actions={
					<>
						<Link href="/superadmin/tenants" className={SECONDARY_BUTTON}>
							{t("viewTenants")}
						</Link>
						<Link href="/superadmin/fleet" className={SECONDARY_BUTTON}>
							{t("viewFleet")}
						</Link>
					</>
				}
			/>

			{page.sourceError ? (
				<>
					<Alert tone="error">{t("sourceErrorBody")}</Alert>
					<Card>
						<EmptyState
							icon={GitCompareArrows}
							title={t("sourceErrorTitle")}
							description={t("sourceErrorBody")}
						/>
					</Card>
				</>
			) : (
				<>
					<Card className="space-y-3 p-5">
						<div className="space-y-1">
							<h2 className="text-sm font-black uppercase tracking-wider text-[#3D5568]">
								{t("pickerTitle")}
							</h2>
							<p className="text-[11px] text-[#3D5568]">
								{t("pickerHint", { min: COMPARISON_MIN_ORGS, max: COMPARISON_MAX_ORGS })}
							</p>
						</div>

						{page.options.length === 0 ? (
							<EmptyState
								icon={GitCompareArrows}
								title={t("noOrgsTitle")}
								description={t("noOrgsDescription")}
							/>
						) : (
							<form action={formAction} method="get" className="space-y-3">
								<ul className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
									{page.options.map((option) => {
										const Icon = ICON[option.state];
										return (
											<li key={option.orgId}>
												<label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-[#0A3D62] hover:bg-[#F4F7F6]">
													<input
														type="checkbox"
														name="org"
														value={option.orgId}
														defaultChecked={selected.includes(option.orgId)}
														className={CHECKBOX_CLASS}
													/>
													<span className="min-w-0 flex-1 truncate font-bold">
														{option.orgName}
													</span>
													<Badge tone={TONE[option.state]} icon={Icon}>
														{tBands(`states.${option.state}`)}
													</Badge>
												</label>
											</li>
										);
									})}
								</ul>
								<button type="submit" className={SECONDARY_BUTTON}>
									<GitCompareArrows className="h-4 w-4" aria-hidden="true" />
									{t("compare")}
								</button>
							</form>
						)}

						{selection.truncated ? (
							<Alert tone="warning">{t("selectionTruncated", { max: COMPARISON_MAX_ORGS })}</Alert>
						) : null}
						{selection.droppedOrgIds.length > 0 ? (
							<Alert tone="warning">
								{t("selectionDropped", { count: selection.droppedOrgIds.length })}
							</Alert>
						) : null}
					</Card>

					{!hasComparison ? (
						<Card>
							<EmptyState
								icon={GitCompareArrows}
								title={selected.length === 0 ? t("emptyTitle") : t("needTwoTitle")}
								description={
									selected.length === 0
										? t("emptyDescription")
										: t("needTwoDescription", { min: COMPARISON_MIN_ORGS })
								}
							/>
						</Card>
					) : (
						<>
							{comparison.unknownOrgIds.length > 0 ? (
								<Alert tone="warning">
									{t("unknownBody", { count: comparison.unknownOrgIds.length })}
								</Alert>
							) : null}
							{comparison.missingOrgIds.length > 0 ? (
								<Alert tone="warning">
									{t("missingOrgIds", { count: comparison.missingOrgIds.length })}
								</Alert>
							) : null}
							{page.truncated ? <Alert tone="warning">{t("truncatedBody")}</Alert> : null}

							<section aria-label={t("tableLabel")} className="space-y-3">
								<h2 className="text-sm font-black uppercase tracking-wider text-[#3D5568]">
									{t("comparisonTitle")}
								</h2>
								<p className="text-[11px] text-[#3D5568]">{t("legend")}</p>

								<TableFrame label={t("tableLabel")} columns={columns} minWidth="min-w-[64rem]">
									{comparison.rows.map((row) => {
										const RowIcon = ICON[row.state];
										return (
											<tr key={row.orgId} className="border-b border-gray-100 last:border-0">
												<th
													scope="row"
													className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62]"
												>
													{row.orgName}
												</th>
												<td className="px-6 py-3">
													<Badge tone={TONE[row.state]} icon={RowIcon}>
														{tBands(`states.${row.state}`)}
													</Badge>
												</td>
												<td className="px-6 py-3 text-sm text-[#3D5568]">
													{t(`orgStatus.${row.orgStatus}`)}
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													{valueText(row, "members")}
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													{valueText(row, "ponds")}
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													{valueText(row, "devices")}
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													<BestValue best={isBest("reporting", row.orgId)} label={t("best")}>
														{valueText(row, "reporting")}
													</BestValue>
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													<BestValue best={isBest("offlinePct", row.orgId)} label={t("best")}>
														{percentText(row)}
													</BestValue>
												</td>
												<td className="px-6 py-3 text-sm text-[#3D5568]">
													<BestValue best={isBest("lastHeartbeatAt", row.orgId)} label={t("best")}>
														{row.lastHeartbeatAt
															? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
															: t("never")}
													</BestValue>
												</td>
												<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
													<BestValue best={isBest("openAlerts", row.orgId)} label={t("best")}>
														{valueText(row, "openAlerts")}
													</BestValue>
												</td>
											</tr>
										);
									})}
								</TableFrame>

								{/* Mobile: the same rows as cards, no horizontal scrolling. */}
								<ul className="space-y-3 md:hidden">
									{comparison.rows.map((row) => {
										const RowIcon = ICON[row.state];
										return (
											<MobileCard key={row.orgId}>
												<div className="flex items-start justify-between gap-2">
													<p className="min-w-0 text-sm font-bold text-[#0A3D62]">{row.orgName}</p>
													<Badge tone={TONE[row.state]} icon={RowIcon}>
														{tBands(`states.${row.state}`)}
													</Badge>
												</div>
												<dl className="grid grid-cols-2 gap-2 text-[11px] text-[#3D5568]">
													<div>
														<dt className="font-bold">{t("columnReporting")}</dt>
														<dd>{valueText(row, "reporting")}</dd>
													</div>
													<div>
														<dt className="font-bold">{t("columnOffline")}</dt>
														<dd>{percentText(row)}</dd>
													</div>
													<div>
														<dt className="font-bold">{t("columnAlerts")}</dt>
														<dd>{valueText(row, "openAlerts")}</dd>
													</div>
													<div>
														<dt className="font-bold">{t("columnHeartbeat")}</dt>
														<dd>
															{row.lastHeartbeatAt
																? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
																: t("never")}
														</dd>
													</div>
												</dl>
											</MobileCard>
										);
									})}
								</ul>

								<p className="text-[11px] text-[#3D5568]">
									{t("checkedAt", { time: formatDateTimeLocal(page.checkedAt, tDates).full })}
								</p>
							</section>
						</>
					)}
				</>
			)}
		</div>
	);
}

/** A value with a "best on this metric" mark; the mark is text, not colour alone. */
function BestValue({
	best,
	label,
	children,
}: {
	best: boolean;
	label: string;
	children: ReactNode;
}) {
	if (!best) return <>{children}</>;
	return (
		<span className="inline-flex items-center gap-1.5">
			{children}
			<span
				className={cn(
					"rounded-full bg-[#E8F5EC] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#1E7B34]",
				)}
			>
				{label}
			</span>
		</span>
	);
}
