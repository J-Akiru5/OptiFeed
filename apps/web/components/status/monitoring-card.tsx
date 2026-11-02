"use client";

import { FeedLevelDisplay } from "@/components/feed-level-display";
import { MonitoringHealthNote } from "@/components/status/monitoring-health-note";
import {
	type MonitoringHealth,
	type MonitoringSummary,
	monitoringHealthState,
	summarizeMonitoring,
} from "@/components/status/monitoring-status";
import {
	MONITORING_BAR_CLASSES,
	MONITORING_TONE_CLASSES,
	MonitoringStatusBadge,
	MonitoringStatusIcon,
	monitoringStatusLabel,
} from "@/components/status/monitoring-status-badge";
import { Link } from "@/i18n/routing";
import { getFeedLevelDisplay } from "@/lib/feed-level";
import { cn } from "@/lib/utils";
import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";

const STATUS_DESCRIPTION_ID = "sidebar-monitoring-status";
const HEALTH_DESCRIPTION_ID = "sidebar-monitoring-health";

export interface MonitoringCardProps {
	hopperLevelPct: number | null;
	hopperLevelUpdatedAt: Date | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number | null;
	feedsPerDay: number | null;
	/** True only for the full offline state; weak signal keeps a live reading. */
	isOffline: boolean;
	/** True when the unit is online but the hopper sensor is not answering (#574). */
	sensorOffline?: boolean;
	connection: "online" | "weak" | "offline" | "missing";
	health: MonitoringHealth | null;
	collapsed: boolean;
}

/**
 * One monitoring card for the desktop sidebar (issue #575).
 *
 * It keeps the existing hopper reading and link to the hopper chart and adds
 * the device connection badge and the fault / safe-mode line, so a farmer does
 * not have to look in the header, the dashboard cards and the sidebar
 * separately. The whole card stays one link; the badge and health line are
 * plain text and icons, never nested controls.
 */
export function MonitoringCard({
	hopperLevelPct,
	hopperLevelUpdatedAt,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
	isOffline,
	sensorOffline = false,
	connection,
	health,
	collapsed,
}: MonitoringCardProps) {
	const t = useTranslations("nav");
	const tMonitoring = useTranslations("dashboard.monitoring");

	const summary: MonitoringSummary = summarizeMonitoring({ connection, health });
	const healthState = monitoringHealthState(health);

	// Same estimate as the dashboard card (#263): level × the device's capacity,
	// divided by the device's grams per feeding. No hard-coded capacity or dose.
	const level = getFeedLevelDisplay({
		levelPercent: hopperLevelPct,
		updatedAt: hopperLevelUpdatedAt,
		isDeviceOffline: isOffline,
		isSensorOffline: sensorOffline,
		hopperCapacityG,
		gramsPerFeeding: gramsPerFeeding ?? 0,
		feedsPerDay: feedsPerDay ?? 0,
	});
	const remainingKg =
		level.state === "live" && level.remainingGrams !== null
			? (level.remainingGrams / 1000).toFixed(1)
			: null;
	const scheduledFeedings = remainingKg !== null ? (level.feedingsRemaining ?? 0) : 0;
	const percentLabel = level.percent !== null ? `${level.percent}%` : "—";
	const statusLabel = monitoringStatusLabel(summary, tMonitoring);
	const healthDescription = healthState === "unknown" ? undefined : HEALTH_DESCRIPTION_ID;

	if (collapsed) {
		return (
			<Link
				href="/dashboard/history#hopper-level"
				aria-label={tMonitoring("summaryLabel", {
					status: statusLabel,
					percent: percentLabel,
				})}
				aria-describedby={healthDescription}
				title={t("viewHopperLevel")}
				data-monitoring-tone={summary.tone}
				className="relative flex min-h-11 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62]/5 p-2 transition-colors hover:border-[#0A3D62]/25 hover:bg-[#0A3D62]/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700/50 dark:bg-gray-800/60 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
			>
				<span
					aria-hidden="true"
					className={cn("absolute inset-y-0 left-0 w-1", MONITORING_BAR_CLASSES[summary.tone])}
				/>
				<span
					className={cn(
						"flex h-7 w-7 items-center justify-center rounded-xl ring-1 ring-inset",
						MONITORING_TONE_CLASSES[summary.tone],
					)}
				>
					<MonitoringStatusIcon kind={summary.kind} className="h-4 w-4" />
				</span>
				<span className="font-mono text-[10px] font-bold tabular-nums text-[#0A3D62] dark:text-gray-200">
					{percentLabel}
				</span>
				{healthState === "safe_mode" || healthState === "fault" ? (
					<span aria-hidden="true" className="h-1 w-1 rounded-full bg-[#FACC15]" />
				) : null}
				<MonitoringHealthNote id={HEALTH_DESCRIPTION_ID} health={health} className="sr-only" />
			</Link>
		);
	}

	return (
		<Link
			href="/dashboard/history#hopper-level"
			aria-label={t("viewHopperLevel")}
			aria-describedby={
				healthDescription
					? `${STATUS_DESCRIPTION_ID} ${HEALTH_DESCRIPTION_ID}`
					: STATUS_DESCRIPTION_ID
			}
			data-monitoring-tone={summary.tone}
			className="relative block space-y-3 overflow-hidden rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62]/5 p-4 transition-colors hover:border-[#0A3D62]/25 hover:bg-[#0A3D62]/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700/50 dark:bg-gray-800/60 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
		>
			<span
				aria-hidden="true"
				className={cn("absolute inset-y-0 left-0 w-1", MONITORING_BAR_CLASSES[summary.tone])}
			/>
			<span id={STATUS_DESCRIPTION_ID} className="sr-only">
				{tMonitoring("summaryLabel", { status: statusLabel, percent: percentLabel })}
			</span>

			<div className="flex flex-wrap items-center gap-2">
				<p className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-widest text-[#3D5568] uppercase dark:text-gray-400">
					<Cpu
						aria-hidden="true"
						className="h-3.5 w-3.5 shrink-0 text-[#C2410C] dark:text-[#ff8a5c]"
					/>
					{tMonitoring("title")}
				</p>
				<MonitoringStatusBadge summary={summary} className="ml-auto" />
			</div>

			<div className="space-y-1">
				<div className="flex items-center justify-between gap-2 text-[10px] font-extrabold text-[#0A3D62] uppercase dark:text-[#5b9bd5]">
					<span className="truncate">{t("pondFeedPellet")}</span>
					<span className="shrink-0 tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("hopperLevel")}
					</span>
				</div>
				<FeedLevelDisplay
					levelPercent={hopperLevelPct}
					updatedAt={hopperLevelUpdatedAt}
					isOffline={isOffline}
					sensorOffline={sensorOffline}
					size="sm"
				/>
				{remainingKg !== null && (
					<p className="font-mono text-[10px] leading-tight text-[#3D5568] dark:text-gray-400">
						{t("hopperRemaining", { kg: remainingKg, count: scheduledFeedings })}
					</p>
				)}
			</div>

			<MonitoringHealthNote id={HEALTH_DESCRIPTION_ID} health={health} />
		</Link>
	);
}
