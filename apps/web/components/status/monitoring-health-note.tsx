"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type MonitoringHealth,
	monitoringHealthMessage,
	monitoringHealthState,
} from "./monitoring-status";

/**
 * The fault / safe-mode line under the hopper reading (issue #575).
 *
 * A null health view (no active feeder) renders nothing instead of inventing
 * an "all clear". Safe mode and active faults get the yellow treatment the
 * issue asks for; a clear or not-yet-reported unit keeps a quiet green line, so
 * "no faults reported" is visible rather than implied by the absence of a
 * warning. The shared health reader normalises a missing row to its healthy
 * view, which is why the line says "reported" rather than "healthy".
 */
export function MonitoringHealthNote({
	health,
	id,
	className,
}: {
	health: MonitoringHealth | null;
	id?: string;
	className?: string;
}) {
	const t = useTranslations("dashboard.monitoring");
	const message = monitoringHealthMessage(health);
	if (!message) return null;

	const state = monitoringHealthState(health);
	const warning = state === "safe_mode" || state === "fault";
	const Icon =
		state === "safe_mode" ? ShieldAlert : state === "fault" ? AlertTriangle : CheckCircle2;
	const label =
		message.key === "healthFaults" ? t(message.key, { count: message.count }) : t(message.key);

	return (
		<p
			id={id}
			data-monitoring-health={state}
			className={cn(
				"flex items-start gap-1.5 text-[10px] font-bold leading-snug",
				warning
					? "rounded-lg bg-[#FACC15] px-2 py-1 text-[#3B2F00]"
					: "text-[#1E7B34] dark:text-[#4ade80]",
				className,
			)}
		>
			<Icon aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
			<span>{label}</span>
		</p>
	);
}
