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
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { type IncidentSeverity, incidentAgeMs } from "@/lib/platform/incident-rules";
import { type SourceState, getIncidentQueue } from "@/lib/platform/incidents";
import type { BandState } from "@/lib/platform/status-band-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	HelpCircle,
	Info,
	type LucideIcon,
	OctagonAlert,
	Radio,
	ReceiptText,
	Timer,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Incident queue (issue #479, M3C.5).
 *
 * One page for "what is open, how bad, how long" across the four sources that
 * already exist. Every row is derived on read by `lib/platform/incidents.ts`
 * (no incident table, no lifecycle — that is M3C.6 and is still gated), and the
 * severity of a pond's device condition is the status bands' own threshold.
 *
 * Honest by construction: a source that did not report is listed as such and
 * the queue verdict becomes Unknown, so an empty list is never rendered as "all
 * clear". Server-rendered, no client JavaScript, no polling.
 */

const SEVERITY_TONE: Record<IncidentSeverity, "danger" | "warning" | "neutral"> = {
	critical: "danger",
	warning: "warning",
	info: "neutral",
};

const SEVERITY_ICON: Record<IncidentSeverity, LucideIcon> = {
	critical: OctagonAlert,
	warning: AlertTriangle,
	info: Info,
};

const SEVERITY_TEXT: Record<IncidentSeverity, string> = {
	critical: "text-[#C42B3A]",
	warning: "text-[#B45309]",
	info: "text-[#3D5568]",
};

const BAND_ICON: Record<BandState, LucideIcon> = {
	ok: CheckCircle2,
	degraded: AlertTriangle,
	critical: OctagonAlert,
	unknown: HelpCircle,
};

const BAND_TONE: Record<BandState, "success" | "warning" | "danger" | "neutral"> = {
	ok: "success",
	degraded: "warning",
	critical: "danger",
	unknown: "neutral",
};

const BAND_TEXT: Record<BandState, string> = {
	ok: "text-[#1E7B34]",
	degraded: "text-[#B45309]",
	critical: "text-[#C42B3A]",
	unknown: "text-[#3D5568]",
};

const SOURCE_META: Record<keyof SourceState, { icon: LucideIcon; key: string }> = {
	device: { icon: Radio, key: "sourceDevice" },
	notification: { icon: AlertTriangle, key: "sourceNotification" },
	error: { icon: FileText, key: "sourceError" },
	job: { icon: Timer, key: "sourceJob" },
};

const SOURCE_KEYS = ["device", "notification", "error", "job"] as const;

const SEVERITY_KEYS = ["critical", "warning", "info"] as const;

export default async function SuperadminIncidentsPage() {
	await requirePlatformAdmin();

	const [queue, t, tBands, tDates, locale] = await Promise.all([
		getIncidentQueue(),
		getTranslations("superadmin.incidents"),
		getTranslations("superadmin.statusBands"),
		getTranslations("dates"),
		getLocale(),
	]);

	const number = (value: number) => new Intl.NumberFormat(locale).format(value);
	const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

	const formatAge = (since: Date | null) => {
		const ageMs = incidentAgeMs(since, queue.checkedAt);
		if (ageMs === null) return t("notReported");
		const minutes = Math.round(ageMs / (60 * 1000));
		if (minutes < 60) return relative.format(-minutes, "minute");
		const hours = Math.round(minutes / 60);
		if (hours < 48) return relative.format(-hours, "hour");
		return relative.format(-Math.round(hours / 24), "day");
	};

	const what = (incident: (typeof queue.incidents)[number]) => {
		if (incident.title) return incident.title;
		if (incident.detail) {
			return t("deviceCondition", {
				offline: number(incident.detail.offline),
				total: number(incident.detail.total),
			});
		}
		return t("notReported");
	};

	const where = (incident: (typeof queue.incidents)[number]) => {
		if (incident.tenantName && incident.pondName) {
			return t("whereBoth", { tenant: incident.tenantName, pond: incident.pondName });
		}
		if (incident.tenantName) return incident.tenantName;
		if (incident.pondName) return incident.pondName;
		return t("unassigned");
	};

	const StateIcon = BAND_ICON[queue.summary.state];

	const columns = [
		{ key: "severity", label: t("columnSeverity") },
		{ key: "what", label: t("columnWhat") },
		{ key: "where", label: t("columnWhere") },
		{ key: "sources", label: t("columnSource") },
		{ key: "since", label: t("columnSince") },
		{ key: "age", label: t("columnAge") },
		{ key: "count", label: t("columnCount") },
	];

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: queue.summary.open })}
				actions={
					<>
						<Link href="/superadmin/fleet" className={SECONDARY_BUTTON}>
							{t("viewFleet")}
						</Link>
						<Link href="/superadmin/operations/errors" className={SECONDARY_BUTTON}>
							{t("viewErrors")}
						</Link>
					</>
				}
			/>

			<section aria-label={t("summaryLabel")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("queueState")}
					</span>
					<div className="flex items-center gap-2">
						<StateIcon
							className={cn("h-5 w-5 shrink-0", BAND_TEXT[queue.summary.state])}
							aria-hidden="true"
						/>
						<span className="text-2xl font-black text-[#0A3D62]">
							{tBands(`states.${queue.summary.state}`)}
						</span>
						<Badge tone={BAND_TONE[queue.summary.state]} icon={StateIcon}>
							{tBands(`states.${queue.summary.state}`)}
						</Badge>
					</div>
					<p className="text-[11px] text-[#3D5568]">
						{t("checkedAt", { time: formatDateTimeLocal(queue.checkedAt, tDates).full })}
					</p>
					<p className="text-[11px] text-[#3D5568]">{t("rankRule")}</p>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("bySeverity")}
					</span>
					<ul className="space-y-1 text-[11px] font-bold text-[#3D5568]">
						{SEVERITY_KEYS.map((severity) => {
							const Icon = SEVERITY_ICON[severity];
							return (
								<li key={severity} className="flex items-center justify-between gap-2">
									<span className="flex items-center gap-1.5">
										<Icon
											className={cn("h-3 w-3 shrink-0", SEVERITY_TEXT[severity])}
											aria-hidden="true"
										/>
										{t(`severity.${severity}`)}
									</span>
									<span className="tabular-nums text-[#0A3D62]">
										{number(queue.summary.counts[severity])}
									</span>
								</li>
							);
						})}
					</ul>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("sourcesTitle")}
					</span>
					<ul className="space-y-1 text-[11px] font-bold text-[#3D5568]">
						{SOURCE_KEYS.map((source) => {
							const meta = SOURCE_META[source];
							const reported = queue.sourceStates[source];
							const Icon = reported ? CheckCircle2 : OctagonAlert;
							return (
								<li key={source} className="flex items-center justify-between gap-2">
									<span className="flex items-center gap-1.5">
										<meta.icon className="h-3 w-3 shrink-0 text-[#3D5568]" aria-hidden="true" />
										{t(meta.key)}
									</span>
									<span
										className={cn(
											"flex items-center gap-1",
											reported ? "text-[#1E7B34]" : "text-[#C42B3A]",
										)}
									>
										<Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
										{reported ? t("sourceReported") : t("sourceFailed")}
									</span>
								</li>
							);
						})}
					</ul>
					<p className="text-[11px] text-[#3D5568]">{t("sourcesNote")}</p>
				</Card>
			</section>

			{queue.summary.failedSources.length > 0 && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3 text-xs font-bold text-[#C42B3A]"
				>
					<OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					<div>
						<p>{t("sourceErrorTitle")}</p>
						<p className="mt-1 font-semibold">{t("sourceErrorBody")}</p>
						{!queue.policyAvailable && (
							<p className="mt-1 font-semibold">{t("policyUnavailable")}</p>
						)}
					</div>
				</div>
			)}

			{queue.truncated && (
				<p className="text-[11px] font-bold text-[#3D5568]">
					{t("truncated", { count: number(queue.incidents.length) })}
				</p>
			)}

			{queue.incidents.length === 0 ? (
				<Card>
					<EmptyState
						icon={ReceiptText}
						title={t("emptyTitle")}
						description={
							queue.summary.failedSources.length > 0 ? t("sourceErrorBody") : t("emptyDescription")
						}
					/>
				</Card>
			) : (
				<>
					<TableFrame label={t("tableLabel")} columns={columns} minWidth="min-w-[58rem]">
						{queue.incidents.map((incident) => {
							const Icon = SEVERITY_ICON[incident.severity];
							return (
								<tr key={incident.key} className="border-b border-gray-100 last:border-0">
									<td className="px-6 py-3">
										<Badge tone={SEVERITY_TONE[incident.severity]} icon={Icon}>
											{t(`severity.${incident.severity}`)}
										</Badge>
									</td>
									<th scope="row" className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62]">
										{incident.href ? (
											<Link href={incident.href} className="underline decoration-dotted">
												{what(incident)}
											</Link>
										) : (
											what(incident)
										)}
									</th>
									<td className="px-6 py-3 text-sm text-[#3D5568]">{where(incident)}</td>
									<td className="px-6 py-3 text-[11px] font-bold uppercase tracking-wide text-[#3D5568]">
										{incident.sources.map((source) => t(SOURCE_META[source].key)).join(" · ")}
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568]">
										{incident.since
											? formatDateTimeLocal(incident.since, tDates).full
											: t("notReported")}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{formatAge(incident.since)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568]">
										{number(incident.count)}
									</td>
								</tr>
							);
						})}
					</TableFrame>

					{/* Mobile: the same rows as cards, no horizontal scrolling. */}
					<ul className="space-y-3 md:hidden">
						{queue.incidents.map((incident) => {
							const Icon = SEVERITY_ICON[incident.severity];
							return (
								<MobileCard key={incident.key}>
									<div className="flex items-start justify-between gap-2">
										<p className="min-w-0 text-sm font-bold text-[#0A3D62]">{what(incident)}</p>
										<Badge tone={SEVERITY_TONE[incident.severity]} icon={Icon}>
											{t(`severity.${incident.severity}`)}
										</Badge>
									</div>
									<p className="text-[11px] font-bold text-[#3D5568]">{where(incident)}</p>
									<dl className="grid grid-cols-2 gap-2 text-[11px]">
										<MetaPair label={t("columnAge")}>{formatAge(incident.since)}</MetaPair>
										<MetaPair label={t("columnCount")}>{number(incident.count)}</MetaPair>
										<MetaPair label={t("columnSource")}>
											{incident.sources.map((source) => t(SOURCE_META[source].key)).join(" · ")}
										</MetaPair>
										<MetaPair label={t("columnSince")}>
											{incident.since
												? formatDateTimeLocal(incident.since, tDates).full
												: t("notReported")}
										</MetaPair>
									</dl>
								</MobileCard>
							);
						})}
					</ul>
				</>
			)}
		</div>
	);
}
