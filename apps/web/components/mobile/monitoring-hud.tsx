"use client";

import {
	type MonitoringHealth,
	monitoringHealthMessage,
	summarizeMonitoring,
} from "@/components/status/monitoring-status";
import {
	MONITORING_BAR_CLASSES,
	MONITORING_HUD_BORDER_CLASSES,
	MonitoringStatusBadge,
} from "@/components/status/monitoring-status-badge";
import { Link } from "@/i18n/routing";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronUp, Gauge, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * The floating mobile status chip and its device-health panel (issues #575,
 * #574).
 *
 * The collapsed chip is deliberately small: it sits on the top edge of the
 * bottom bar, clear of the chat FAB, and repeats only what an operator needs at
 * a glance — connection state, hopper level, and a yellow tag when a fault is
 * live. Tapping it expands a panel with the detail Android users expect from a
 * status surface: connection, hopper sensor, active faults and the level
 * reading, plus the way into the history.
 *
 * The panel is rendered in the DOM at all times and simply hidden while closed,
 * so the history destination exists for assistive tech and for the static
 * markup the monitoring tests assert on. Warnings stay prominent: the red
 * connection badge and the yellow fault tag never move into the panel.
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
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		closeRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

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

	const connectionLabel =
		connection === "online"
			? t("statusOnline")
			: connection === "weak"
				? t("statusWeak")
				: connection === "offline"
					? t("statusOffline")
					: t("statusNoDevice");
	const sensorLabel = sensorOffline ? tFeedLevel("sensorOffline") : t("sensorOk");
	const levelLabel =
		display.state === "stale" ? `${percentLabel} · ${t("lastKnownShort")}` : percentLabel;

	return (
		<div
			data-testid="monitoring-hud"
			className="fixed right-[calc(var(--ofd-fab-inset)+var(--ofd-fab-size)+0.75rem)] bottom-[calc(var(--ofd-bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)] left-3 z-40 lg:hidden"
		>
			<div
				id="device-health-panel"
				hidden={!open}
				className={cn(
					"absolute bottom-full left-0 mb-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border-2 bg-[#06263f] p-3 text-white shadow-2xl dark:bg-[#0b3554]",
					MONITORING_HUD_BORDER_CLASSES[summary.tone],
				)}
			>
				<div className="flex items-center justify-between gap-2">
					<p className="text-[11px] font-black tracking-wide uppercase">{t("panelTitle")}</p>
					<button
						ref={closeRef}
						type="button"
						onClick={() => {
							setOpen(false);
							triggerRef.current?.focus();
						}}
						aria-label={t("close")}
						className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
					>
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>

				<dl className="mt-1 space-y-1.5 text-xs">
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-white/70">{t("connection")}</dt>
						<dd className="font-black">{connectionLabel}</dd>
					</div>
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-white/70">{t("sensor")}</dt>
						<dd className={cn("font-black", sensorOffline && "text-[#FACC15]")}>{sensorLabel}</dd>
					</div>
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-white/70">{t("faults")}</dt>
						<dd
							className={cn(
								"font-black",
								summary.faultCount > 0 || summary.secondaryHealth === "safe_mode"
									? "text-[#FACC15]"
									: "text-white",
							)}
						>
							{healthLabel ?? secondaryLabel ?? t("healthClear")}
						</dd>
					</div>
					<div className="flex items-baseline justify-between gap-3">
						<dt className="text-white/70">{tNav("hopperLevel")}</dt>
						<dd className="font-mono font-black tabular-nums">{levelLabel}</dd>
					</div>
				</dl>

				<Link
					href="/dashboard/history#hopper-level"
					className="mt-2 flex min-h-11 items-center justify-between rounded-xl bg-white/10 px-3 text-xs font-bold transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
				>
					{tNav("viewHopperLevel")}
					<ChevronRight aria-hidden="true" className="h-4 w-4" />
				</Link>
			</div>

			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls="device-health-panel"
				data-monitoring-tone={summary.tone}
				className={cn(
					"relative flex min-h-12 min-w-0 w-full items-center gap-2 overflow-hidden rounded-2xl border-2 bg-[#06263f] px-2.5 py-1.5 pl-3.5 text-left text-white shadow-lg transition-colors hover:bg-[#0b3554] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#06263f] focus-visible:outline-none dark:bg-[#0b3554] dark:hover:bg-[#0f4265] dark:focus-visible:ring-offset-[#0b3554]",
					MONITORING_HUD_BORDER_CLASSES[summary.tone],
				)}
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

				<ChevronUp
					aria-hidden="true"
					className={cn(
						"ml-auto h-4 w-4 shrink-0 text-white/70 transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>
		</div>
	);
}
