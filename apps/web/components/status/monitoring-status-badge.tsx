"use client";

import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	Cpu,
	type LucideIcon,
	ShieldAlert,
	Wifi,
	WifiLow,
	WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type MonitoringStatusKind,
	type MonitoringSummary,
	type MonitoringTone,
	monitoringStatusMessage,
} from "./monitoring-status";

/**
 * Colour + icon + text for the quick-view state (issue #575).
 *
 * The issue's palette is intentional: online/active is high-contrast orange,
 * a fault or safe mode is yellow, and offline is red. Every badge also carries
 * an icon and its translated label, so the state never relies on hue alone.
 */ export const MONITORING_TONE_CLASSES: Record<MonitoringTone, string> = {
	active:
		"bg-[#C2410C] text-white ring-black/10 shadow-[0_2px_10px_rgba(194,65,12,0.35)] dark:bg-[#FF5A1F] dark:text-white dark:ring-white/20",
	attention:
		"bg-[#FACC15] text-[#3B2F00] ring-black/15 shadow-[0_2px_10px_rgba(250,204,21,0.35)] dark:ring-white/20",
	offline:
		"bg-[#C42B3A] text-white ring-black/10 shadow-[0_2px_10px_rgba(196,43,58,0.35)] dark:ring-white/20",
	neutral:
		"bg-gray-200 text-[#0A3D62] ring-black/10 shadow-sm dark:bg-gray-700 dark:text-gray-100 dark:ring-white/15",
};

/** The status accent as a solid bar, for the sidebar card and mobile HUD edges. */
export const MONITORING_BAR_CLASSES: Record<MonitoringTone, string> = {
	active: "bg-[#C2410C]",
	attention: "bg-[#FACC15]",
	offline: "bg-[#C42B3A]",
	neutral: "bg-gray-400 dark:bg-gray-500",
};

const STATUS_ICONS: Record<MonitoringStatusKind, LucideIcon> = {
	online: Wifi,
	weak: WifiLow,
	offline: WifiOff,
	safe_mode: ShieldAlert,
	fault: AlertTriangle,
	missing: Cpu,
};

/** The same glyph the badge uses, for the collapsed sidebar state. */
export function MonitoringStatusIcon({
	kind,
	className,
}: {
	kind: MonitoringStatusKind;
	className?: string;
}) {
	const Icon = STATUS_ICONS[kind];
	return <Icon aria-hidden="true" className={className} />;
}

export function monitoringStatusLabel(
	summary: MonitoringSummary,
	t: (key: string, values?: { count: number }) => string,
): string {
	const message = monitoringStatusMessage(summary);
	return message.key === "statusFault" ? t(message.key, { count: message.count }) : t(message.key);
}

export function MonitoringStatusBadge({
	summary,
	size = "sm",
	className,
}: {
	summary: MonitoringSummary;
	size?: "sm" | "md";
	className?: string;
}) {
	const t = useTranslations("dashboard.monitoring");
	const label = monitoringStatusLabel(summary, t);

	return (
		<span
			data-monitoring-tone={summary.tone}
			data-monitoring-status={summary.kind}
			className={cn(
				"inline-flex max-w-full min-w-0 items-center gap-1 rounded-full font-black uppercase tracking-wider ring-1 ring-inset",
				size === "md" ? "px-2.5 py-1 text-[10px]" : "px-2 py-0.5 text-[9px]",
				MONITORING_TONE_CLASSES[summary.tone],
				className,
			)}
		>
			<MonitoringStatusIcon
				kind={summary.kind}
				className={size === "md" ? "h-3.5 w-3.5 shrink-0" : "h-3 w-3 shrink-0"}
			/>
			<span className="truncate">{label}</span>
		</span>
	);
}
