import { IncidentDetailActions } from "@/components/superadmin/incident-detail-actions";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	MetaPair,
	PageHeader,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	type TrackedIncidentEventRow,
	type TrackedIncidentRow,
	getPlatformIncidentDetail,
} from "@/lib/platform/incident-lifecycle";
import type {
	PlatformIncidentEventType,
	PlatformIncidentSeverity,
	PlatformIncidentSource,
	PlatformIncidentStatus,
} from "@/lib/platform/incident-lifecycle-rules";
import { platformIncidentAgeMs } from "@/lib/platform/incident-lifecycle-rules";
import type { IncidentSeverity } from "@/lib/platform/incident-rules";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowUp,
	CheckCircle2,
	Circle,
	Eye,
	FileText,
	HelpCircle,
	Info,
	type LucideIcon,
	OctagonAlert,
	Search,
	Timer,
	UserRoundPlus,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

/**
 * One tracked incident: what happened, who owns it, and the full timeline
 * (issue #479, M3C.6).
 *
 * The page is a review surface only. Every transition is validated and written
 * by `lib/actions/platform/incidents.ts` under the platform-admin gate, with a
 * reason, a timeline event and an audit row. `actorId = null` on an event means
 * the device-watch sync made the transition; the page says "System".
 *
 * A failed timeline read is flagged, never rendered as an incident with no
 * history. Resolved is terminal for operator actions in this slice; the system
 * reopens the same row if the condition returns.
 */

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

const SOURCE_KEY: Record<PlatformIncidentSource, string> = {
	DEVICE_OFFLINE: "sourceDeviceOffline",
	SAFE_MODE: "sourceSafeMode",
	FAULT: "sourceFault",
	FAILED_JOB: "sourceFailedJob",
	NOTIFICATION: "sourceNotification",
	MANUAL: "sourceManual",
};

const EVENT_KEY: Record<PlatformIncidentEventType, string> = {
	AUTO_OPENED: "autoOpened",
	AUTO_RESOLVED: "autoResolved",
	ACKNOWLEDGED: "acknowledged",
	INVESTIGATING: "investigating",
	RESOLVED: "resolved",
	ESCALATED: "escalated",
	NOTIFIED: "notified",
};

const EVENT_ICON: Record<PlatformIncidentEventType, LucideIcon> = {
	AUTO_OPENED: Circle,
	AUTO_RESOLVED: CheckCircle2,
	ACKNOWLEDGED: Eye,
	INVESTIGATING: Search,
	RESOLVED: CheckCircle2,
	ESCALATED: ArrowUp,
	NOTIFIED: UserRoundPlus,
};

const KNOWN_FAULTS = new Set(["hopper_sensor", "rtc", "relay_overrun"]);

const MUTED = "text-[#3D5568] dark:text-slate-400";

export default async function SuperadminIncidentDetailPage({
	params,
}: {
	params: Promise<{ incidentId: string }>;
}) {
	await requirePlatformAdmin();

	const { incidentId } = await params;
	const [detail, t, tDates, locale] = await Promise.all([
		getPlatformIncidentDetail(incidentId),
		getTranslations("superadmin.incidents"),
		getTranslations("dates"),
		getLocale(),
	]);
	if (!detail) notFound();

	const incident = detail.incident;
	const now = new Date();
	const number = (value: number) => new Intl.NumberFormat(locale).format(value);
	const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const ageMs = platformIncidentAgeMs(incident.openedAt, now);
	const formatAge = (since: Date) => {
		const value = platformIncidentAgeMs(since, now);
		const minutes = Math.round(value / (60 * 1000));
		if (minutes < 60) return relative.format(-minutes, "minute");
		const hours = Math.round(minutes / 60);
		if (hours < 48) return relative.format(-hours, "hour");
		return relative.format(-Math.round(hours / 24), "day");
	};

	const where = (() => {
		if (incident.orgName && incident.pondName) {
			return t("whereBoth", { tenant: incident.orgName, pond: incident.pondName });
		}
		if (incident.orgName) return incident.orgName;
		if (incident.pondName) return incident.pondName;
		if (incident.deviceLabel) return incident.deviceLabel;
		return t("unassigned");
	})();

	const severityKey = TRACKED_SEVERITY_KEY[incident.severity];
	const SeverityIcon = SEVERITY_ICON[severityKey];
	const StatusIcon = STATUS_ICON[incident.status];

	const trackedDevice = incident.deviceLabel ?? incident.title;
	const displayTitle = (() => {
		if (incident.source === "DEVICE_OFFLINE") {
			return t("titleDeviceOffline", { device: trackedDevice });
		}
		if (incident.source === "SAFE_MODE") return t("titleSafeMode", { device: trackedDevice });
		if (incident.source === "FAULT") {
			const fault =
				incident.fault && KNOWN_FAULTS.has(incident.fault)
					? t(`faults.${incident.fault}`)
					: (incident.fault ?? incident.title);
			return t("titleFault", { device: trackedDevice, fault });
		}
		if (incident.source === "FAILED_JOB") {
			return t("titleFailedJob", { job: incident.jobType ?? incident.title });
		}
		return incident.title;
	})();

	const eventLabel = (event: TrackedIncidentEventRow) => t(`event.${EVENT_KEY[event.type]}`);

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2">
				<Link href="/superadmin/incidents" className={SECONDARY_BUTTON}>
					<ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					{t("detail.back")}
				</Link>
			</div>

			<PageHeader
				title={displayTitle}
				description={t("detail.subtitle", {
					source: t(SOURCE_KEY[incident.source]),
					status: t(`status.${STATUS_KEY[incident.status]}`),
				})}
			/>

			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={STATUS_TONE[incident.status]} icon={StatusIcon}>
					{t(`status.${STATUS_KEY[incident.status]}`)}
				</Badge>
				<Badge tone={SEVERITY_TONE[severityKey]} icon={SeverityIcon}>
					{t(`severity.${severityKey}`)}
				</Badge>
				<Badge tone="neutral" icon={FileText}>
					{t(SOURCE_KEY[incident.source])}
				</Badge>
				{incident.ackOverdue && (
					<Badge tone="danger" icon={OctagonAlert}>
						{t("ackOverdue")}
					</Badge>
				)}
			</div>

			<section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="p-5 lg:col-span-2">
					<h2 className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
						{t("detail.factsTitle")}
					</h2>
					<dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
						<MetaPair label={t("columnStatus")}>
							{t(`status.${STATUS_KEY[incident.status]}`)}
						</MetaPair>
						<MetaPair label={t("detail.source")}>{t(SOURCE_KEY[incident.source])}</MetaPair>
						<MetaPair label={t("columnSeverity")}>{t(`severity.${severityKey}`)}</MetaPair>
						<MetaPair label={t("columnWhere")}>{where}</MetaPair>
						<MetaPair label={t("columnOwner")}>
							{incident.ownerName ?? t("ownerUnassigned")}
						</MetaPair>
						<MetaPair label={t("columnOpened")}>
							{formatDateTimeLocal(incident.openedAt, tDates).full}
						</MetaPair>
						<MetaPair label={t("columnAge")}>{formatAge(incident.openedAt)}</MetaPair>
						<MetaPair label={t("columnAck")}>
							{incident.ackDueAt
								? formatDateTimeLocal(incident.ackDueAt, tDates).full
								: t("ackNone")}
						</MetaPair>
						<MetaPair label={t("detail.lastSeen")}>
							{formatDateTimeLocal(incident.lastSeenAt, tDates).full}
						</MetaPair>
						<MetaPair label={t("detail.device")}>
							{incident.deviceLabel ?? t("notReported")}
						</MetaPair>
						<MetaPair label={t("detail.dedupeKey")}>{incident.dedupeKey}</MetaPair>
						<MetaPair label={t("detail.ageMinutes")}>{number(Math.round(ageMs / 60000))}</MetaPair>
					</dl>
				</Card>

				<Card className="p-5">
					<h2 className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
						{t("detail.summaryTitle")}
					</h2>
					<p className={`mt-2 text-xs leading-relaxed ${MUTED}`}>
						{incident.summary ?? t("detail.summaryEmpty")}
					</p>
					{incident.status === "RESOLVED" && incident.resolvedAt && (
						<p className="mt-2 text-xs font-bold text-[#1E7B34]">
							{t("detail.resolvedAt", {
								time: formatDateTimeLocal(incident.resolvedAt, tDates).full,
							})}
						</p>
					)}
				</Card>
			</section>

			<IncidentDetailActions
				incidentId={incident.id}
				status={incident.status}
				owners={detail.owners}
				ownersAvailable={detail.ownersAvailable}
			/>

			<section className="space-y-3">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
						{t("detail.timelineTitle")}
					</h2>
					<p className={`mt-1 text-sm ${MUTED}`}>{t("detail.timelineDescription")}</p>
				</div>

				{!detail.eventsAvailable ? (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-xl border border-console-critical-content/30 bg-console-critical-surface px-4 py-3 text-xs font-bold text-console-critical-content"
					>
						<OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<p>{t("detail.timelineUnavailable")}</p>
					</div>
				) : detail.events.length === 0 ? (
					<Card>
						<EmptyState icon={Timer} title={t("detail.timelineEmpty")} />
					</Card>
				) : (
					<ol className="space-y-3">
						{detail.events.map((event) => {
							const Icon = EVENT_ICON[event.type];
							return (
								<li key={event.id}>
									<Card className="p-4">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-2">
												<Icon
													className="h-4 w-4 shrink-0 text-[#0A3D62] dark:text-slate-300"
													aria-hidden="true"
												/>
												<span className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
													{eventLabel(event)}
												</span>
												<span className={`text-[11px] font-bold ${MUTED}`}>
													{event.actorName ?? t("detail.actorSystem")}
												</span>
											</div>
											<time
												dateTime={event.createdAt.toISOString()}
												className={`text-[11px] font-bold ${MUTED}`}
											>
												{formatDateTimeLocal(event.createdAt, tDates).full}
											</time>
										</div>
										{event.fromStatus && event.toStatus && (
											<p className={`mt-2 text-[11px] font-bold ${MUTED}`}>
												{t("detail.transition", {
													from: t(`status.${STATUS_KEY[event.fromStatus]}`),
													to: t(`status.${STATUS_KEY[event.toStatus]}`),
												})}
											</p>
										)}
										{event.note && (
											<p className="mt-2 text-xs leading-relaxed text-[#0A3D62] dark:text-slate-300">
												{event.note}
											</p>
										)}
									</Card>
								</li>
							);
						})}
					</ol>
				)}
			</section>
		</div>
	);
}
