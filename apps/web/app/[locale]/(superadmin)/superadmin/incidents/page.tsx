import {
	Badge,
	type BadgeTone,
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
import type { TrackedIncidentRow } from "@/lib/platform/incident-lifecycle";
import type {
	PlatformIncidentSeverity,
	PlatformIncidentSource,
	PlatformIncidentStatus,
} from "@/lib/platform/incident-lifecycle-rules";
import { type IncidentSeverity, incidentAgeMs } from "@/lib/platform/incident-rules";
import { type SourceState, getIncidentQueue } from "@/lib/platform/incidents";
import type { BandState } from "@/lib/platform/status-band-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	ArrowUp,
	CheckCircle2,
	Circle,
	Eye,
	FileText,
	HelpCircle,
	Info,
	type LucideIcon,
	Megaphone,
	OctagonAlert,
	Radio,
	ReceiptText,
	Search,
	Timer,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Incident queue and tracked incidents (issue #479, M3C.5 and M3C.6).
 *
 * Two layers, one page:
 *
 *  - **Tracked incidents** are stored rows written by the device-watch sync or
 *    moved by a platform admin. They have a status, an owner, a 30-minute
 *    acknowledgement target after escalation, and a timeline on the detail
 *    page. Escalated rows are announced here to the whole platform-admin role,
 *    in-app only (plan decision O20).
 *  - **Derived conditions** are the original read model: one row per source
 *    condition, computed from rows that already exist and never stored.
 *
 * Keeping them visually separate is deliberate. The tracked row is the
 * lifecycle; the derived row is evidence from a source. Honesty rules are the
 * same in both: a failed read is named, an unread source never renders as clear,
 * and status is always an icon plus words, never colour alone.
 */

const SEVERITY_TONE: Record<IncidentSeverity, BadgeTone> = {
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
	info: "text-[#3D5568] dark:text-gray-400",
};

const BAND_ICON: Record<BandState, LucideIcon> = {
	ok: CheckCircle2,
	degraded: AlertTriangle,
	critical: OctagonAlert,
	unknown: HelpCircle,
};

const BAND_TONE: Record<BandState, BadgeTone> = {
	ok: "success",
	degraded: "warning",
	critical: "danger",
	unknown: "neutral",
};

const BAND_TEXT: Record<BandState, string> = {
	ok: "text-[#1E7B34]",
	degraded: "text-[#B45309]",
	critical: "text-[#C42B3A]",
	unknown: "text-[#3D5568] dark:text-gray-400",
};

const SOURCE_META: Record<keyof SourceState, { icon: LucideIcon; key: string }> = {
	device: { icon: Radio, key: "sourceDevice" },
	notification: { icon: AlertTriangle, key: "sourceNotification" },
	error: { icon: FileText, key: "sourceError" },
	job: { icon: Timer, key: "sourceJob" },
};

const SOURCE_KEYS = ["device", "notification", "error", "job"] as const;

const SEVERITY_KEYS = ["critical", "warning", "info"] as const;

const STATUS_TONE: Record<PlatformIncidentStatus, BadgeTone> = {
	NEW: "neutral",
	ACKNOWLEDGED: "brand",
	INVESTIGATING: "warning",
	RESOLVED: "success",
	ESCALATED: "danger",
};

const STATUS_ICON: Record<PlatformIncidentStatus, LucideIcon> = {
	NEW: Circle,
	ACKNOWLEDGED: Eye,
	INVESTIGATING: Search,
	RESOLVED: CheckCircle2,
	ESCALATED: ArrowUp,
};

const STATUS_KEY: Record<PlatformIncidentStatus, string> = {
	NEW: "new",
	ACKNOWLEDGED: "acknowledged",
	INVESTIGATING: "investigating",
	RESOLVED: "resolved",
	ESCALATED: "escalated",
};

const TRACKED_SEVERITY_KEY: Record<PlatformIncidentSeverity, IncidentSeverity> = {
	CRITICAL: "critical",
	WARNING: "warning",
	INFO: "info",
};

const TRACKED_SOURCE_KEY: Record<PlatformIncidentSource, string> = {
	DEVICE_OFFLINE: "sourceDeviceOffline",
	SAFE_MODE: "sourceSafeMode",
	FAULT: "sourceFault",
	FAILED_JOB: "sourceFailedJob",
	NOTIFICATION: "sourceNotification",
	MANUAL: "sourceManual",
};

const KNOWN_FAULTS = new Set(["hopper_sensor", "rtc", "relay_overrun"]);

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

	const trackedDevice = (row: TrackedIncidentRow) => row.deviceLabel ?? row.title;

	const trackedWhat = (row: TrackedIncidentRow) => {
		if (row.source === "DEVICE_OFFLINE") {
			return t("titleDeviceOffline", { device: trackedDevice(row) });
		}
		if (row.source === "SAFE_MODE") {
			return t("titleSafeMode", { device: trackedDevice(row) });
		}
		if (row.source === "FAULT") {
			const fault =
				row.fault && KNOWN_FAULTS.has(row.fault)
					? t(`faults.${row.fault}`)
					: (row.fault ?? row.title);
			return t("titleFault", { device: trackedDevice(row), fault });
		}
		if (row.source === "FAILED_JOB") {
			return t("titleFailedJob", { job: row.jobType ?? row.title });
		}
		return row.title;
	};

	const trackedWhere = (row: TrackedIncidentRow) => {
		if (row.orgName && row.pondName) {
			return t("whereBoth", { tenant: row.orgName, pond: row.pondName });
		}
		if (row.orgName) return row.orgName;
		if (row.pondName) return row.pondName;
		if (row.deviceLabel) return row.deviceLabel;
		return t("unassigned");
	};

	const ackTarget = (row: TrackedIncidentRow) => {
		if (row.status === "RESOLVED") return t("ackClosed");
		if (!row.ackDueAt) return t("ackNone");
		const due = formatDateTimeLocal(row.ackDueAt, tDates).full;
		if (!row.ackOverdue) return due;
		return (
			<span className="flex flex-col gap-1">
				<Badge tone="danger" icon={OctagonAlert}>
					{t("ackOverdue")}
				</Badge>
				<span>{due}</span>
			</span>
		);
	};

	const StateIcon = BAND_ICON[queue.summary.state];
	const escalatedRows = queue.tracked.rows.filter((row) => row.status === "ESCALATED");

	const columns = [
		{ key: "severity", label: t("columnSeverity") },
		{ key: "what", label: t("columnWhat") },
		{ key: "where", label: t("columnWhere") },
		{ key: "sources", label: t("columnSource") },
		{ key: "since", label: t("columnSince") },
		{ key: "age", label: t("columnAge") },
		{ key: "count", label: t("columnCount") },
	];

	const trackedColumns = [
		{ key: "status", label: t("columnStatus") },
		{ key: "severity", label: t("columnSeverity") },
		{ key: "what", label: t("columnWhat") },
		{ key: "where", label: t("columnWhere") },
		{ key: "owner", label: t("columnOwner") },
		{ key: "ack", label: t("columnAck") },
		{ key: "opened", label: t("columnOpened") },
		{ key: "age", label: t("columnAge") },
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

			<section
				aria-label={t("trackedSummaryLabel")}
				className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
			>
				<Card className="flex flex-col gap-1 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("trackedOpen")}
					</span>
					<span className="text-2xl font-black tabular-nums text-[#0A3D62] dark:text-gray-100">
						{queue.tracked.available ? number(queue.tracked.summary.open) : t("notReported")}
					</span>
				</Card>
				<Card className="flex flex-col gap-1 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("trackedEscalated")}
					</span>
					<span className="text-2xl font-black tabular-nums text-[#0A3D62] dark:text-gray-100">
						{queue.tracked.available ? number(queue.tracked.summary.escalated) : t("notReported")}
					</span>
				</Card>
				<Card className="flex flex-col gap-1 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("trackedOverdue")}
					</span>
					<span
						className={cn(
							"text-2xl font-black tabular-nums",
							queue.tracked.available && queue.tracked.summary.overdue > 0
								? "text-[#C42B3A]"
								: "text-[#0A3D62] dark:text-gray-100",
						)}
					>
						{queue.tracked.available ? number(queue.tracked.summary.overdue) : t("notReported")}
					</span>
				</Card>
				<Card className="flex flex-col gap-1 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("trackedResolved")}
					</span>
					<span className="text-2xl font-black tabular-nums text-[#0A3D62] dark:text-gray-100">
						{queue.tracked.available ? number(queue.tracked.summary.resolved) : t("notReported")}
					</span>
					<span className="text-[11px] text-[#3D5568] dark:text-gray-400">
						{t("trackedResolvedHint")}
					</span>
				</Card>
			</section>

			<section className="space-y-4">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
						{t("trackedTitle")}
					</h2>
					<p className="mt-1 max-w-3xl text-sm text-[#3D5568] dark:text-slate-400">
						{t("trackedDescription")}
					</p>
				</div>

				{!queue.tracked.available && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-xl border border-console-critical-content/30 bg-console-critical-surface px-4 py-3 text-xs font-bold text-console-critical-content"
					>
						<OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<div>
							<p>{t("trackedUnavailableTitle")}</p>
							<p className="mt-1 font-semibold">{t("trackedUnavailableBody")}</p>
						</div>
					</div>
				)}

				{queue.tracked.available && escalatedRows.length > 0 && (
					// biome-ignore lint/a11y/useSemanticElements: a live status region that wraps a list; <output> cannot hold list content.
					<div
						role="status"
						className="rounded-xl border border-[#E85A2A]/40 bg-[#FFF3E8] px-4 py-3 text-xs text-[#7A3B0E] dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200"
					>
						<div className="flex items-start gap-2">
							<Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
							<div className="min-w-0">
								<p className="font-black">{t("escalatedTitle")}</p>
								<p className="mt-1 font-semibold">{t("escalatedBody")}</p>
								<ul className="mt-2 space-y-1">
									{escalatedRows.slice(0, 5).map((row) => (
										<li key={row.id} className="flex flex-wrap items-center gap-2">
											<Link
												href={`/superadmin/incidents/${row.id}`}
												className="font-bold underline decoration-dotted"
											>
												{trackedWhat(row)}
											</Link>
											<span>
												{t("escalatedOwner")}: {row.ownerName ?? t("ownerUnassigned")}
											</span>
											<span>
												{t("escalatedDue")}:{" "}
												{row.ackDueAt
													? formatDateTimeLocal(row.ackDueAt, tDates).full
													: t("ackNone")}
											</span>
											{row.ackOverdue && (
												<Badge tone="danger" icon={OctagonAlert}>
													{t("ackOverdue")}
												</Badge>
											)}
										</li>
									))}
								</ul>
							</div>
						</div>
					</div>
				)}

				{queue.tracked.available && queue.tracked.truncated && (
					<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
						{t("trackedTruncated", {
							shown: number(queue.tracked.rows.filter((row) => row.status !== "RESOLVED").length),
							total: number(queue.tracked.totalOpen),
						})}
					</p>
				)}

				{queue.tracked.available && queue.tracked.rows.length === 0 ? (
					<Card>
						<EmptyState
							icon={ReceiptText}
							title={t("trackedEmptyTitle")}
							description={t("trackedEmptyDescription")}
						/>
					</Card>
				) : queue.tracked.available ? (
					<>
						<TableFrame
							className="hidden md:block"
							label={t("trackedTableLabel")}
							columns={trackedColumns}
							minWidth="min-w-[66rem]"
						>
							{queue.tracked.rows.map((row) => {
								const SeverityIcon = SEVERITY_ICON[TRACKED_SEVERITY_KEY[row.severity]];
								const StatusIcon = STATUS_ICON[row.status];
								return (
									<tr key={row.id} className="border-b border-gray-100 last:border-0">
										<td className="px-6 py-3">
											<Badge tone={STATUS_TONE[row.status]} icon={StatusIcon}>
												{t(`status.${STATUS_KEY[row.status]}`)}
											</Badge>
										</td>
										<td className="px-6 py-3">
											<Badge
												tone={SEVERITY_TONE[TRACKED_SEVERITY_KEY[row.severity]]}
												icon={SeverityIcon}
											>
												{t(`severity.${TRACKED_SEVERITY_KEY[row.severity]}`)}
											</Badge>
										</td>
										<th
											scope="row"
											className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-gray-100"
										>
											<Link
												href={`/superadmin/incidents/${row.id}`}
												className="underline decoration-dotted"
											>
												{trackedWhat(row)}
											</Link>
											<span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
												{t(TRACKED_SOURCE_KEY[row.source])}
											</span>
										</th>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{trackedWhere(row)}
										</td>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{row.ownerName ?? t("ownerUnassigned")}
										</td>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{ackTarget(row)}
										</td>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{formatDateTimeLocal(row.openedAt, tDates).full}
										</td>
										<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
											{formatAge(row.openedAt)}
										</td>
									</tr>
								);
							})}
						</TableFrame>

						<ul className="space-y-3 md:hidden">
							{queue.tracked.rows.map((row) => {
								const SeverityIcon = SEVERITY_ICON[TRACKED_SEVERITY_KEY[row.severity]];
								const StatusIcon = STATUS_ICON[row.status];
								return (
									<MobileCard key={row.id}>
										<div className="flex items-start justify-between gap-2">
											<Link
												href={`/superadmin/incidents/${row.id}`}
												className="min-w-0 text-sm font-bold text-[#0A3D62] underline decoration-dotted dark:text-gray-100"
											>
												{trackedWhat(row)}
											</Link>
											<Badge tone={STATUS_TONE[row.status]} icon={StatusIcon}>
												{t(`status.${STATUS_KEY[row.status]}`)}
											</Badge>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Badge
												tone={SEVERITY_TONE[TRACKED_SEVERITY_KEY[row.severity]]}
												icon={SeverityIcon}
											>
												{t(`severity.${TRACKED_SEVERITY_KEY[row.severity]}`)}
											</Badge>
											<span className="text-[11px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
												{t(TRACKED_SOURCE_KEY[row.source])}
											</span>
										</div>
										<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
											{trackedWhere(row)}
										</p>
										<dl className="grid grid-cols-2 gap-2 text-[11px]">
											<MetaPair label={t("columnOwner")}>
												{row.ownerName ?? t("ownerUnassigned")}
											</MetaPair>
											<MetaPair label={t("columnAck")}>{ackTarget(row)}</MetaPair>
											<MetaPair label={t("columnOpened")}>
												{formatDateTimeLocal(row.openedAt, tDates).full}
											</MetaPair>
											<MetaPair label={t("columnAge")}>{formatAge(row.openedAt)}</MetaPair>
										</dl>
									</MobileCard>
								);
							})}
						</ul>
					</>
				) : null}
			</section>

			<section className="space-y-4">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
						{t("derivedTitle")}
					</h2>
					<p className="mt-1 max-w-3xl text-sm text-[#3D5568] dark:text-slate-400">
						{t("derivedDescription")}
					</p>
				</div>

				<section aria-label={t("summaryLabel")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
					<Card className="flex flex-col gap-2 p-5">
						<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{t("queueState")}
						</span>
						<div className="flex items-center gap-2">
							<StateIcon
								className={cn("h-5 w-5 shrink-0", BAND_TEXT[queue.summary.state])}
								aria-hidden="true"
							/>
							<span className="text-2xl font-black text-[#0A3D62] dark:text-gray-100">
								{tBands(`states.${queue.summary.state}`)}
							</span>
							<Badge tone={BAND_TONE[queue.summary.state]} icon={StateIcon}>
								{tBands(`states.${queue.summary.state}`)}
							</Badge>
						</div>
						<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
							{t("checkedAt", { time: formatDateTimeLocal(queue.checkedAt, tDates).full })}
						</p>
						<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("rankRule")}</p>
					</Card>

					<Card className="flex flex-col gap-2 p-5">
						<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{t("bySeverity")}
						</span>
						<ul className="space-y-1 text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
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
										<span className="tabular-nums text-[#0A3D62] dark:text-gray-100">
											{number(queue.summary.counts[severity])}
										</span>
									</li>
								);
							})}
						</ul>
					</Card>

					<Card className="flex flex-col gap-2 p-5">
						<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{t("sourcesTitle")}
						</span>
						<ul className="space-y-1 text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
							{SOURCE_KEYS.map((source) => {
								const meta = SOURCE_META[source];
								const reported = queue.sourceStates[source];
								const Icon = reported ? CheckCircle2 : OctagonAlert;
								return (
									<li key={source} className="flex items-center justify-between gap-2">
										<span className="flex items-center gap-1.5">
											<meta.icon
												className="h-3 w-3 shrink-0 text-[#3D5568] dark:text-gray-400"
												aria-hidden="true"
											/>
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
						<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("sourcesNote")}</p>
					</Card>
				</section>

				{queue.summary.failedSources.length > 0 && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-xl border border-console-critical-content/30 bg-console-critical-surface px-4 py-3 text-xs font-bold text-console-critical-content"
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
					<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
						{t("truncated", { count: number(queue.incidents.length) })}
					</p>
				)}

				{queue.incidents.length === 0 ? (
					<Card>
						<EmptyState
							icon={ReceiptText}
							title={t("emptyTitle")}
							description={
								queue.summary.failedSources.length > 0
									? t("sourceErrorBody")
									: t("emptyDescription")
							}
						/>
					</Card>
				) : (
					<>
						<TableFrame
							className="hidden md:block"
							label={t("tableLabel")}
							columns={columns}
							minWidth="min-w-[58rem]"
						>
							{queue.incidents.map((incident) => {
								const Icon = SEVERITY_ICON[incident.severity];
								return (
									<tr key={incident.key} className="border-b border-gray-100 last:border-0">
										<td className="px-6 py-3">
											<Badge tone={SEVERITY_TONE[incident.severity]} icon={Icon}>
												{t(`severity.${incident.severity}`)}
											</Badge>
										</td>
										<th
											scope="row"
											className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-gray-100"
										>
											{incident.href ? (
												<Link href={incident.href} className="underline decoration-dotted">
													{what(incident)}
												</Link>
											) : (
												what(incident)
											)}
										</th>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{where(incident)}
										</td>
										<td className="px-6 py-3 text-[11px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
											{incident.sources.map((source) => t(SOURCE_META[source].key)).join(" · ")}
										</td>
										<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
											{incident.since
												? formatDateTimeLocal(incident.since, tDates).full
												: t("notReported")}
										</td>
										<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
											{formatAge(incident.since)}
										</td>
										<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
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
											<p className="min-w-0 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
												{what(incident)}
											</p>
											<Badge tone={SEVERITY_TONE[incident.severity]} icon={Icon}>
												{t(`severity.${incident.severity}`)}
											</Badge>
										</div>
										<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
											{where(incident)}
										</p>
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
			</section>
		</div>
	);
}
