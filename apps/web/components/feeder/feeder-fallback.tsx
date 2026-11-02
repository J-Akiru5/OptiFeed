"use client";

import { FeederIllustration } from "@/components/feeder/feeder-illustration";
import { DEFAULT_DEVICE_STATUS_POLICY } from "@/lib/device-status";
import type { FeederStatus } from "@/lib/feeder/feeder-parts";
import { type ReadingAge, isReadingStale, readingAge } from "@/lib/feeder/reading-freshness";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

interface FeederFallbackProps {
	label: string;
	status: FeederStatus;
	feedLevelPercent: number | null;
	lastFedLabel: string | null;
	/** Water-temperature probe health; null when never reported. */
	waterTempOk: boolean | null;
	/** Last calibrated temperature the probe reported. */
	waterTempC?: number | null;
	/** When the probe last reported; null when it never did. */
	waterTempUpdatedAt?: string | null;
	/** RTC health as last reported. */
	rtcOk: boolean | null;
	/** When the unit last checked in; the freshness basis for the RTC bit. */
	lastSeenAt?: string | null;
	/** Reading freshness window, from the device status policy. */
	staleAfterMs?: number;
	/** When the hopper level was measured; stale levels say so with their age. */
	feedLevelUpdatedAt?: string | null;
	/** Fresh Wi-Fi signal in dBm, or null when it is absent/stale. */
	signalDbm?: number | null;
	/** Firmware version reported by the heartbeat. */
	firmwareVersion?: string | null;
	/** Large-screen treatment: bigger readings. */
	kiosk?: boolean;
	/**
	 * Present only when the operator chose the simple view on a capable device
	 * (#626). It returns to the 3D scene; a device without WebGL never gets it,
	 * because there is nothing to go back to.
	 */
	onBackToViewer?: () => void;
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
	waterTempC = null,
	waterTempUpdatedAt = null,
	rtcOk,
	lastSeenAt = null,
	staleAfterMs = DEFAULT_DEVICE_STATUS_POLICY.offlineAfterMs,
	feedLevelUpdatedAt = null,
	signalDbm = null,
	firmwareVersion = null,
	kiosk = false,
	onBackToViewer,
	className,
}: FeederFallbackProps) {
	const t = useTranslations("dashboard.feederViewer");
	const tWater = useTranslations("dashboard.waterTemp");
	const level = feedLevelPercent === null ? null : Math.min(100, Math.max(0, feedLevelPercent));
	const healthOf = (health: boolean | null) =>
		health === null
			? { label: t("healthUnknown"), tone: "text-white/60", dot: "bg-white/40" }
			: health
				? { label: t("healthOk"), tone: "text-emerald-200", dot: "bg-emerald-300" }
				: { label: t("healthFault"), tone: "text-rose-200", dot: "bg-rose-400" };
	// #620: an old reading is not evidence about now, so it is labelled stale
	// with its age instead of being repeated as current.
	const ageLabel = (age: ReadingAge | null): string | null => {
		if (!age) return null;
		switch (age.unit) {
			case "seconds":
				return tWater("secondsAgo", { count: age.count });
			case "minutes":
				return tWater("minutesAgo", { count: age.count });
			case "hours":
				return tWater("hoursAgo", { count: age.count });
			case "days":
				return tWater("daysAgo", { count: age.count });
		}
	};
	const staleHealth = (updatedAt: string | null) =>
		isReadingStale(updatedAt, staleAfterMs)
			? {
					label: [tWater("statusStale"), ageLabel(readingAge(updatedAt))]
						.filter(Boolean)
						.join(" · "),
					tone: "text-amber-200",
					dot: "bg-amber-300",
				}
			: null;
	const waterHealth = staleHealth(waterTempUpdatedAt) ?? healthOf(waterTempOk);
	const rtcHealth = staleHealth(lastSeenAt) ?? healthOf(rtcOk);
	const waterValue = waterTempC === null ? null : `${waterTempC.toFixed(1)} °C`;
	const rtcValue = rtcHealth.label;
	const levelAge = readingAge(feedLevelUpdatedAt);
	const levelStale = isReadingStale(feedLevelUpdatedAt, staleAfterMs);
	const levelValue =
		[
			level === null ? null : `${level}%`,
			levelStale ? [tWater("statusStale"), ageLabel(levelAge)].filter(Boolean).join(" · ") : null,
		]
			.filter(Boolean)
			.join(" · ") || "—";
	const signalLabel = signalDbm === null ? t("healthUnknown") : `${signalDbm} dBm`;
	const stripLabel = cn(
		"font-black uppercase tracking-wider text-white/50",
		kiosk ? "text-xs" : "text-[10px]",
	);
	const stripValue = cn("mt-0.5 font-bold", kiosk && "text-lg");

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
				<div className="flex flex-col items-end gap-2">
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
					{onBackToViewer ? (
						<button
							type="button"
							onClick={onBackToViewer}
							className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
						>
							<RotateCcw className="size-3" aria-hidden="true" />
							{t("backTo3d")}
						</button>
					) : null}
				</div>
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

			<div
				className={cn(
					"grid grid-cols-2 gap-3 border-t border-white/10 pt-3 sm:grid-cols-3",
					kiosk ? "text-base" : "text-xs",
				)}
			>
				<div>
					<p className={stripLabel}>{t("hopperLevel")}</p>
					<p className={stripValue}>{levelValue}</p>
				</div>
				<div>
					<p className={stripLabel}>{t("lastFed")}</p>
					<p className={stripValue}>{lastFedLabel ?? t("noReading")}</p>
				</div>
				<div>
					<p className={stripLabel}>{t("waterTempSensor")}</p>
					<p className={cn(stripValue, "inline-flex items-center gap-1.5", waterHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", waterHealth.dot)}
							aria-hidden="true"
						/>
						{[waterValue, waterHealth.label].filter(Boolean).join(" · ")}
					</p>
				</div>
				<div>
					<p className={stripLabel}>{t("rtc")}</p>
					<p className={cn(stripValue, "inline-flex items-center gap-1.5", rtcHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", rtcHealth.dot)}
							aria-hidden="true"
						/>
						{rtcValue}
					</p>
				</div>
				<div>
					<p className={stripLabel}>{t("signal")}</p>
					<p className={cn(stripValue, signalDbm === null && "text-white/60")}>{signalLabel}</p>
				</div>
				<div>
					<p className={stripLabel}>{t("firmware")}</p>
					<p className={stripValue}>{firmwareVersion ? `v${firmwareVersion}` : "—"}</p>
				</div>
			</div>
		</div>
	);
}
