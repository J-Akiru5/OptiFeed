import {
	Badge,
	Card,
	EmptyState,
	MetaPair,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { parsePage } from "@/lib/pagination";
import type { BandState } from "@/lib/platform/status-band-rules";
import { getTenantHealth } from "@/lib/platform/tenant-health";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	HelpCircle,
	type LucideIcon,
	OctagonAlert,
	Users,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Tenant health table (issue #479, M3C.3).
 *
 * Every organization with the state of its fleet, worst first, paginated. The
 * state is the worst of two facts that already have a rule (`deviceFleetState`
 * and the organization's own status) — this page owns no threshold and no
 * health score.
 *
 * Honest by construction: a tenant with no ponds, or whose units never
 * reported, is Unknown rather than OK, and a failed source or unreadable device
 * policy renders an explicit error state instead of a green table. Ranking
 * happens before paging, so the first page holds the worst tenants.
 *
 * Server-rendered with no client JavaScript and no polling.
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

const ICON_TONE: Record<BandState, string> = {
	ok: "text-[#1E7B34]",
	degraded: "text-[#B45309]",
	critical: "text-[#C42B3A]",
	unknown: "text-[#3D5568]",
};

const BAND_KEYS = ["critical", "degraded", "unknown", "ok"] as const;

export default async function SuperadminTenantsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	await requirePlatformAdmin();

	const params = await searchParams;
	const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;

	const [health, t, tBands, tCommon, tDates, locale] = await Promise.all([
		getTenantHealth(parsePage(rawPage)),
		getTranslations("superadmin.tenants"),
		getTranslations("superadmin.statusBands"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
		getLocale(),
	]);

	const number = (value: number) => new Intl.NumberFormat(locale).format(value);
	const StateIcon = ICON[health.summary.state];

	const columns = [
		{ key: "tenant", label: t("columnTenant") },
		{ key: "members", label: t("columnMembers") },
		{ key: "ponds", label: t("columnPonds") },
		{ key: "devices", label: t("columnDevices") },
		{ key: "reporting", label: t("columnReporting") },
		{ key: "offline", label: t("columnOffline") },
		{ key: "heartbeat", label: t("columnHeartbeat") },
		{ key: "alerts", label: t("columnAlerts") },
		{ key: "state", label: t("columnState") },
	];

	const offlineText = (row: (typeof health.rows)[number]) =>
		row.offlinePct === null ? t("notReported") : `${number(row.offlinePct)}%`;

	const heartbeatText = (row: (typeof health.rows)[number]) =>
		row.lastHeartbeatAt ? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full : t("never");

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={
					health.sourceError
						? t("descriptionFailed")
						: t("description", { count: health.totalTenants })
				}
				actions={
					<>
						<Link href="/superadmin/fleet" className={SECONDARY_BUTTON}>
							{t("viewFleet")}
						</Link>
						<Link href="/superadmin/orgs" className={SECONDARY_BUTTON}>
							{t("viewOrgs")}
						</Link>
					</>
				}
			/>

			<section aria-label={t("summaryLabel")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("platformState")}
					</span>
					<div className="flex items-center gap-2">
						<StateIcon
							className={cn("h-5 w-5 shrink-0", ICON_TONE[health.summary.state])}
							aria-hidden="true"
						/>
						<span className="text-2xl font-black text-[#0A3D62]">
							{tBands(`states.${health.summary.state}`)}
						</span>
						<Badge tone={TONE[health.summary.state]} icon={StateIcon}>
							{tBands(`states.${health.summary.state}`)}
						</Badge>
					</div>
					<p className="text-[11px] text-[#3D5568]">
						{t("checkedAt", { time: formatDateTimeLocal(health.checkedAt, tDates).full })}
					</p>
					<p className="text-[11px] text-[#3D5568]">{t("unknownRule")}</p>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("tenantsByState")}
					</span>
					<ul className="space-y-1 text-[11px] font-bold text-[#3D5568]">
						{BAND_KEYS.map((state) => {
							const Icon = ICON[state];
							return (
								<li key={state} className="flex items-center justify-between gap-2">
									<span className="flex items-center gap-1.5">
										<Icon className={cn("h-3 w-3 shrink-0", ICON_TONE[state])} aria-hidden="true" />
										{tBands(`states.${state}`)}
									</span>
									<span className="tabular-nums text-[#0A3D62]">
										{number(health.summary.counts[state])}
									</span>
								</li>
							);
						})}
					</ul>
					<p className="text-[11px] text-[#3D5568]">{t("worstRule")}</p>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("policyTitle")}
					</span>
					{health.policyAvailable ? (
						<p className="text-[11px] font-bold text-[#0A3D62]">{t("policyApplied")}</p>
					) : (
						<p className="text-[11px] font-bold text-[#3D5568]">{t("policyUnavailable")}</p>
					)}
					<p className="text-[11px] text-[#3D5568]">{t("policySource")}</p>
				</Card>
			</section>

			{health.sourceError && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3 text-xs font-bold text-[#C42B3A]"
				>
					<OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					<div>
						<p>{t("sourceErrorTitle")}</p>
						<p className="mt-1 font-semibold">{t("sourceErrorBody")}</p>
					</div>
				</div>
			)}

			{health.truncated && (
				<p className="text-[11px] font-bold text-[#3D5568]">
					{t("truncated", { count: health.totalTenants })}
				</p>
			)}

			{health.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Users}
						title={t("emptyTitle")}
						description={health.sourceError ? t("sourceErrorBody") : t("emptyDescription")}
					/>
				</Card>
			) : (
				<>
					<TableFrame label={t("tableLabel")} columns={columns} minWidth="min-w-[64rem]">
						{health.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<tr key={row.orgId} className="border-b border-gray-100 last:border-0">
									<th scope="row" className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62]">
										<Link href="/superadmin/orgs" className="underline decoration-dotted">
											{row.orgName}
										</Link>
									</th>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{number(row.members)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{number(row.ponds)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{row.devices === 0 ? t("noDevices") : number(row.devices)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{row.reporting === 0 ? t("neverReported") : number(row.reporting)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{offlineText(row)}
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568]">{heartbeatText(row)}</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{number(row.openAlerts)}
									</td>
									<td className="px-6 py-3">
										<Badge tone={TONE[row.state]} icon={RowIcon}>
											{tBands(`states.${row.state}`)}
										</Badge>
									</td>
								</tr>
							);
						})}
					</TableFrame>

					{/* Mobile: the same rows as cards, no horizontal scrolling. */}
					<ul className="space-y-3 md:hidden">
						{health.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<MobileCard key={row.orgId}>
									<div className="flex items-start justify-between gap-2">
										<p className="min-w-0 text-sm font-bold text-[#0A3D62]">{row.orgName}</p>
										<Badge tone={TONE[row.state]} icon={RowIcon}>
											{tBands(`states.${row.state}`)}
										</Badge>
									</div>
									<dl className="grid grid-cols-2 gap-2 text-[11px]">
										<MetaPair label={t("columnMembers")}>{number(row.members)}</MetaPair>
										<MetaPair label={t("columnPonds")}>{number(row.ponds)}</MetaPair>
										<MetaPair label={t("columnDevices")}>
											{row.devices === 0 ? t("noDevices") : number(row.devices)}
										</MetaPair>
										<MetaPair label={t("columnOffline")}>{offlineText(row)}</MetaPair>
										<MetaPair label={t("columnHeartbeat")}>{heartbeatText(row)}</MetaPair>
										<MetaPair label={t("columnAlerts")}>{number(row.openAlerts)}</MetaPair>
									</dl>
								</MobileCard>
							);
						})}
					</ul>

					<Pagination
						basePath="/superadmin/tenants"
						page={health.pagination.page}
						pageCount={health.pagination.pageCount}
						showing={tCommon("pagination.showing", {
							from: health.pagination.firstRow,
							to: health.pagination.lastRow,
							total: health.pagination.total,
						})}
						previousLabel={tCommon("pagination.previous")}
						nextLabel={tCommon("pagination.next")}
						label={t("paginationLabel")}
					/>
				</>
			)}
		</div>
	);
}
