"use client";

import {
	type MonitoringHealth,
	monitoringHealthMessage,
	summarizeMonitoring,
} from "@/components/status/monitoring-status";
import {
	MONITORING_BAR_CLASSES,
	MonitoringStatusBadge,
} from "@/components/status/monitoring-status-badge";
import { Link } from "@/i18n/routing";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
import { cn } from "@/lib/utils";
import { Gauge } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The floating mobile status HUD (issue #575).
 *
 * It sits on the top edge of the five-tab bottom bar, clear of the chat FAB on
 * the right, so the hopper level and the device state stay visible while the
 * operator scrolls. The panel keeps the issue's colour language: orange for
 * online/weak, yellow for safe mode or a fault, red for offline. The label,
 * icon and progress reading are always present, so colour is not the only cue.
 */
export function MobileMonitoringHud({
	levelPercent,
	levelUpdatedAt,
	sensorOffline = false,
	connection,
	health,
	show = true,
}: {
	levelPercent: number | null;
	levelUpdatedAt: Date | null;
	/** The unit is online but the hopper sensor is not answering (#574). */
	sensorOffline?: boolean;
	connection: "online" | "weak" | "offline" | "missing";
	health: MonitoringHealth | null;
	/** False for a platform admin without farm chrome. */
	show?: boolean;
}) {
	const t = useTranslations("dashboard.monitoring");
	const tNav = useTranslations("nav");
	const tFeedLevel = useTranslations("dashboard.feedLevel");

	if (!show || connection === "missing") return null;

	const summary = summarizeMonitoring({ connection, health });
	const display = resolveFeedLevelDisplay({
		levelPercent,
		updatedAt: levelUpdatedAt,
		isOffline: connection === "offline" || sensorOffline,
	});
	const percentLabel = display.percent !== null ? `${display.percent}%` : "—";
	const healthMessage = monitoringHealthMessage(health);
	const secondaryLabel =
		summary.secondaryHealth === "safe_mode"
			? t("statusSafeMode")
			: summary.secondaryHealth === "fault"
				? t("statusFault", { count: summary.faultCount })
				: null;
	const healthLabel =
		healthMessage === null
			? null
			: healthMessage.key === "healthFaults"
				? t(healthMessage.key, { count: healthMessage.count })
				: t(healthMessage.key);

	return (
		<div
			data-testid="monitoring-hud"
			className="fixed right-[calc(var(--ofd-fab-inset)+var(--ofd-fab-size)+0.75rem)] bottom-[calc(var(--ofd-bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)] left-3 z-40 lg:hidden"
		>
			<Link
				href="/dashboard/history#hopper-level"
				data-monitoring-tone={summary.tone}
				className="relative flex min-h-12 min-w-0 items-center gap-2 overflow-hidden rounded-2xl border border-white/15 bg-[#06263f]/95 px-2.5 py-1.5 pl-3.5 text-white shadow-lg backdrop-blur transition-colors hover:bg-[#0b3554]/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#06263f]"
			>
				<span
					aria-hidden="true"
					className={cn("absolute inset-y-0 left-0 w-1.5", MONITORING_BAR_CLASSES[summary.tone])}
				/>
				<output aria-live="polite" className="flex min-w-0 items-center">
					<MonitoringStatusBadge summary={summary} size="md" />
				</output>

				<span aria-hidden="true" className="h-5 w-px shrink-0 bg-white/20" />

				<span className="flex shrink-0 items-center gap-1">
					<Gauge aria-hidden="true" className="h-3.5 w-3.5 text-white/70" />
					<span className="font-mono text-sm font-black tabular-nums">{percentLabel}</span>
				</span>

				<span className="hidden min-w-0 truncate text-[9px] font-bold tracking-wider text-white/70 uppercase sm:inline">
					{display.state === "stale"
						? sensorOffline
							? tFeedLevel("sensorOffline")
							: t("lastKnownShort")
						: tNav("hopperLevel")}
				</span>

				{secondaryLabel ? (
					<span className="ml-auto shrink-0 rounded-full bg-[#FACC15] px-1.5 py-0.5 text-[9px] font-black text-[#3B2F00]">
						{secondaryLabel}
					</span>
				) : null}

				{healthLabel ? <span className="sr-only">{healthLabel}</span> : null}
			</Link>
		</div>
	);
}
