import {
	Badge,
	Card,
	EmptyState,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getFleetMonitor } from "@/lib/platform/fleet-health";
import type { BandState } from "@/lib/platform/status-band-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	HelpCircle,
	type LucideIcon,
	OctagonAlert,
	Radio,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Fleet monitor (issue #479, M3C.4).
 *
 * The device registry lists units; this page answers the operator's question
 * across tenants: whose fleet is degraded or unmeasured, and why. Every state
 * comes from `lib/platform/fleet-health.ts`, which reuses the connectivity rule
 * and thresholds used by the status bands — this page owns no threshold and no
 * health score of its own.
 *
 * Server-rendered with no client JavaScript and no polling, so a screenshot
 * carries the "checked at" time and reads as stale when it is stale.
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

const MINUTE_MS = 60 * 1000;

export default async function SuperadminFleetPage() {
	await requirePlatformAdmin();

	const [fleet, t, tBands, tDates, locale] = await Promise.all([
		getFleetMonitor(),
		getTranslations("superadmin.fleet"),
		getTranslations("superadmin.statusBands"),
		getTranslations("dates"),
		getLocale(),
	]);

	const number = (value: number) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

	const States = ICON[fleet.summary.state];

	const columns = [
		{ key: "tenant", label: t("columnTenant") },
		{ key: "devices", label: t("columnDevices") },
		{ key: "reporting", label: t("columnReporting") },
		{ key: "offline", label: t("columnOffline") },
		{ key: "heartbeat", label: t("columnHeartbeat") },
		{ key: "state", label: t("columnState") },
	];

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: fleet.totalDevices })}
				actions={
					<>
						<Link href="/superadmin/incidents" className={SECONDARY_BUTTON}>
							{t("viewIncidents")}
						</Link>
						<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
							{t("viewDevices")}
						</Link>
					</>
				}
			/>

			<section aria-label={t("summaryLabel")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("fleetState")}
					</span>
					<div className="flex items-center gap-2">
						<States
							className={cn("h-5 w-5 shrink-0", ICON_TONE[fleet.summary.state])}
							aria-hidden="true"
						/>
						<span className="text-2xl font-black text-[#0A3D62]">
							{tBands(`states.${fleet.summary.state}`)}
						</span>
						<Badge tone={TONE[fleet.summary.state]} icon={States}>
							{tBands(`states.${fleet.summary.state}`)}
						</Badge>
					</div>
					<p className="text-[11px] text-[#3D5568]">
						{t("checkedAt", { time: formatDateTimeLocal(fleet.checkedAt, tDates).full })}
					</p>
					<p className="text-[11px] text-[#3D5568]">{t("unknownRule")}</p>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("tenantsByState")}
					</span>
					<ul className="space-y-1 text-[11px] font-bold text-[#3D5568]">
						{(["critical", "degraded", "unknown", "ok"] as const).map((state) => (
							<li key={state} className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-1.5">
									{(() => {
										const Icon = ICON[state];
										return (
											<Icon
												className={cn("h-3 w-3 shrink-0", ICON_TONE[state])}
												aria-hidden="true"
											/>
										);
									})()}
									{tBands(`states.${state}`)}
								</span>
								<span className="tabular-nums text-[#0A3D62]">
									{number(fleet.summary.counts[state])}
								</span>
							</li>
						))}
					</ul>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("policyTitle")}
					</span>
					{fleet.policy ? (
						<p className="text-[11px] font-bold text-[#0A3D62]">
							{t("policyLine", {
								offline: number(Math.round(fleet.policy.offlineAfterMs / MINUTE_MS)),
								weak: number(Math.round(fleet.policy.weakAfterMs / MINUTE_MS)),
								grace: number(Math.round(fleet.policy.graceMs / MINUTE_MS)),
							})}
						</p>
					) : (
						<p className="text-[11px] font-bold text-[#3D5568]">{t("policyUnavailable")}</p>
					)}
					<p className="text-[11px] text-[#3D5568]">{t("policySource")}</p>
				</Card>
			</section>

			{fleet.sourceError && (
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

			{fleet.truncated && (
				<p className="text-[11px] font-bold text-[#3D5568]">
					{t("truncated", { count: fleet.totalDevices })}
				</p>
			)}

			{fleet.rows.length === 0 ? (
				<Card>
					<EmptyState icon={Radio} title={t("emptyTitle")} description={t("emptyDescription")} />
				</Card>
			) : (
				<>
					<TableFrame label={t("tableLabel")} columns={columns} minWidth="min-w-[52rem]">
						{fleet.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<tr
									key={row.tenantId ?? "__unassigned__"}
									className="border-b border-gray-100 last:border-0"
								>
									<th scope="row" className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62]">
										{row.tenantName ?? t("unassigned")}
									</th>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{number(row.total)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{row.reporting === 0 ? t("neverReported") : number(row.reporting)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{row.offlinePct === null ? t("notReported") : `${number(row.offlinePct)}%`}
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568]">
										{row.lastHeartbeatAt
											? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
											: t("never")}
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
						{fleet.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<li
									key={row.tenantId ?? "__unassigned__"}
									className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
								>
									<div className="flex items-start justify-between gap-2">
										<p className="text-sm font-bold text-[#0A3D62]">
											{row.tenantName ?? t("unassigned")}
										</p>
										<Badge tone={TONE[row.state]} icon={RowIcon}>
											{tBands(`states.${row.state}`)}
										</Badge>
									</div>
									<dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
										<div>
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
												{t("columnDevices")}
											</dt>
											<dd className="font-bold text-[#0A3D62]">{number(row.total)}</dd>
										</div>
										<div>
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
												{t("columnOffline")}
											</dt>
											<dd className="font-bold text-[#0A3D62]">
												{row.offlinePct === null ? t("notReported") : `${number(row.offlinePct)}%`}
											</dd>
										</div>
										<div className="col-span-2">
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
												{t("columnHeartbeat")}
											</dt>
											<dd className="font-bold text-[#0A3D62]">
												{row.lastHeartbeatAt
													? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
													: t("never")}
											</dd>
										</div>
									</dl>
								</li>
							);
						})}
					</ul>
				</>
			)}
		</div>
	);
}
