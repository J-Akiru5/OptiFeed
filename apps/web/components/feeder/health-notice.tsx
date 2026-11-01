"use client";

import { formatDateTimeLocal } from "@/lib/date-local";
import { type DeviceHealthView, deviceNeedsAttention } from "@/lib/device-health-model";
import { cn } from "@/lib/utils";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

const REFUSAL_REASON_KEYS: Record<string, string> = {
	safe_mode: "refusalReasonSafeMode",
	brownout_hold: "refusalReasonBrownoutHold",
	ota_in_progress: "refusalReasonOtaInProgress",
	ota_pending_verify: "refusalReasonOtaPendingVerify",
	busy: "refusalReasonBusy",
	grams_out_of_range: "refusalReasonGramsOutOfRange",
	dose_time_exceeds_cap: "refusalReasonDoseTooLong",
	daily_gram_cap_exceeded: "refusalReasonDailyCap",
	too_soon: "refusalReasonTooSoon",
	hourly_limit: "refusalReasonHourlyLimit",
	relay_overrun: "refusalReasonRelayOverrun",
};

const REFUSAL_SOURCE_KEYS: Record<string, string> = {
	dashboard: "refusalSourceDashboard",
	scheduled: "refusalSourceScheduled",
	button: "refusalSourceButton",
};

const FAULT_KEYS = {
	hopper_sensor: "healthFaultHopperSensor",
	rtc: "healthFaultRtc",
	relay_overrun: "healthFaultRelayOverrun",
} as const;

/** The hero sits on a dark card; the settings page is themed light or dark. */
const HEALTH_TONES = {
	dark: {
		safe: "border-[#C42B3A]/45 bg-[#C42B3A]/20 text-[#ffc0c7]",
		fault: "border-[#B45309]/50 bg-[#B45309]/25 text-[#ffd8a8]",
		refusal: "text-white/70",
	},
	themed: {
		safe: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
		fault:
			"border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
		refusal: "text-muted-foreground",
	},
} as const;

/**
 * What the unit itself reports about its health: safe mode (relay locked off
 * after repeated resets), active faults and the last refused dose. Text first,
 * colour second, and nothing at all while the feeder is healthy.
 */
export function HealthNotice({
	health,
	tone = "dark",
}: {
	health: DeviceHealthView;
	tone?: keyof typeof HEALTH_TONES;
}) {
	const colours = HEALTH_TONES[tone];
	const t = useTranslations("dashboard.feederHero");
	const tDates = useTranslations("dates");

	const attention = deviceNeedsAttention(health);
	const refusal = health.lastRefusal;
	if (!attention && !refusal) return null;

	const since = health.since ? formatDateTimeLocal(health.since, tDates) : null;
	const refusalAt = refusal ? formatDateTimeLocal(refusal.at, tDates) : null;
	const reasonKey = refusal ? REFUSAL_REASON_KEYS[refusal.reason] : undefined;
	const sourceKey = refusal?.source ? REFUSAL_SOURCE_KEYS[refusal.source] : undefined;

	return (
		<div className="relative mt-3 space-y-2" data-testid="feeder-hero-health" data-tone={tone}>
			{health.safeMode ? (
				<div role="alert" className={cn("rounded-2xl border p-3", colours.safe)}>
					<p className="flex items-center gap-1.5 text-xs font-black">
						<ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
						{t("healthSafeModeTitle")}
					</p>
					<p className="mt-1 text-[11px] font-semibold leading-snug">{t("healthSafeModeBody")}</p>
					{health.resetReasons ? (
						<p className="mt-1 text-[11px] font-semibold">
							{t("healthResets", { reasons: health.resetReasons })}
						</p>
					) : null}
					{since ? (
						<p className="mt-1 text-[10px] font-semibold opacity-80">
							{t("healthSince", { date: since.date, time: since.time })}
						</p>
					) : null}
				</div>
			) : null}
			{health.faults.length > 0 ? (
				<output className={cn("block rounded-2xl border p-3", colours.fault)}>
					<p className="flex items-center gap-1.5 text-xs font-black">
						<AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
						{t("healthFaultsTitle")}
					</p>
					<ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] font-semibold leading-snug">
						{health.faults.map((fault) => (
							<li key={fault}>{t(FAULT_KEYS[fault])}</li>
						))}
					</ul>
				</output>
			) : null}
			{refusal && refusalAt ? (
				<p className={cn("text-[11px] font-semibold", colours.refusal)}>
					<span className="font-black">{t("refusalTitle")}: </span>
					{t("refusalDetail", {
						grams: Math.round(refusal.grams ?? 0),
						source: sourceKey ? t(sourceKey) : (refusal.source ?? "-"),
						date: refusalAt.date,
						time: refusalAt.time,
						reason: reasonKey ? t(reasonKey) : t("refusalReasonOther", { code: refusal.reason }),
					})}
				</p>
			) : null}
		</div>
	);
}
