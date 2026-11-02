"use client";

import { FeederIllustration } from "@/components/feeder/feeder-illustration";
import type { FeederStatus } from "@/lib/feeder/feeder-parts";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface FeederFallbackProps {
	label: string;
	status: FeederStatus;
	feedLevelPercent: number | null;
	lastFedLabel: string | null;
	/** Water-temperature probe health; null when never reported. */
	waterTempOk: boolean | null;
	/** RTC health as last reported. */
	rtcOk: boolean | null;
	className?: string;
}

/**
 * The no-WebGL / low-tier view (plan v1.1.0).
 *
 * It is not decorative: it carries the same live status and hopper reading as
 * the 3D scene, so a phone on a software renderer loses the orbit controls but
 * not the information.
 */
export function FeederFallback({
	label,
	status,
	feedLevelPercent,
	lastFedLabel,
	waterTempOk,
	rtcOk,
	className,
}: FeederFallbackProps) {
	const t = useTranslations("dashboard.feederViewer");
	const level = feedLevelPercent === null ? null : Math.min(100, Math.max(0, feedLevelPercent));
	const healthOf = (health: boolean | null) =>
		health === null
			? { label: t("healthUnknown"), tone: "text-white/60", dot: "bg-white/40" }
			: health
				? { label: t("healthOk"), tone: "text-emerald-200", dot: "bg-emerald-300" }
				: { label: t("healthFault"), tone: "text-rose-200", dot: "bg-rose-400" };
	const waterHealth = healthOf(waterTempOk);
	const rtcHealth = healthOf(rtcOk);

	return (
		<div
			className={cn(
				"relative flex min-h-[280px] flex-col overflow-hidden rounded-3xl border border-[#0A3D62]/10 bg-[#0B2336] p-5 text-white dark:border-white/10",
				className,
			)}
			data-testid="feeder-viewer-fallback"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
						{t("viewerLabel")}
					</p>
					<p className="mt-1 text-lg font-black">{label}</p>
				</div>
				<span
					className={cn(
						"rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
						status === "offline"
							? "bg-white/10 text-white/70"
							: status === "dispensing"
								? "bg-emerald-400/15 text-emerald-200"
								: status === "paused"
									? "bg-amber-300/15 text-amber-200"
									: status === "weak"
										? "bg-amber-400/15 text-amber-200"
										: "bg-sky-300/15 text-sky-200",
					)}
				>
					{t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
				</span>
			</div>

			<div className="relative mx-auto my-3 w-full max-w-[420px] flex-1">
				<FeederIllustration className="h-full w-full" />
				<div className="absolute inset-x-[22%] bottom-[16%] h-2 overflow-hidden rounded-full bg-white/15">
					<div
						className="h-full rounded-full bg-[#E85A2A] transition-[width] duration-500 motion-reduce:transition-none"
						style={{ width: `${level ?? 0}%` }}
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/50">
						{t("hopperLevel")}
					</p>
					<p className="mt-0.5 font-bold">{level === null ? "—" : `${level}%`}</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/50">
						{t("lastFed")}
					</p>
					<p className="mt-0.5 font-bold">{lastFedLabel ?? t("noReading")}</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/50">
						{t("waterTempSensor")}
					</p>
					<p className={cn("mt-0.5 inline-flex items-center gap-1.5 font-bold", waterHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", waterHealth.dot)}
							aria-hidden="true"
						/>
						{waterHealth.label}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/50">
						{t("rtc")}
					</p>
					<p className={cn("mt-0.5 inline-flex items-center gap-1.5 font-bold", rtcHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", rtcHealth.dot)}
							aria-hidden="true"
						/>
						{rtcHealth.label}
					</p>
				</div>
			</div>
		</div>
	);
}
