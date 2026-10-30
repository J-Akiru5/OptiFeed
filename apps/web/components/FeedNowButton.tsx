"use client";

import { Link } from "@/i18n/routing";
import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
import { type FeedNowLimit, formatFeedGrams } from "@/lib/limits-core";
import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { Activity, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface FeedNowButtonProps {
	deviceId: string;
	nextFeedingVolume: string;
	label: string;
	deviceName?: string;
	connectionStatus?: string;
	/** Last known hopper level; null/undefined means the device never reported one. */
	hopperLevelPct?: number | null;
	canWrite?: boolean;
	isFallow?: boolean;
	gramsPerSecond?: number;
	/** Effective Feed Now ceiling (issue #387); the dose is capped to this. */
	feedNowLimit?: FeedNowLimit | null;
	"data-onboard"?: string;
}

export function FeedNowButton({
	deviceId,
	nextFeedingVolume,
	label,
	deviceName = "ILO-POND-01",
	connectionStatus = "online",
	hopperLevelPct = null,
	canWrite = true,
	isFallow = false,
	gramsPerSecond,
	feedNowLimit = null,
	"data-onboard": dataOnboard,
}: FeedNowButtonProps) {
	const t = useTranslations("dashboard.feedNowModal");
	const tBtn = useTranslations("button");

	const [dispensing, setDispensing] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);
	const online = useOnlineStatus();

	const isOffline = connectionStatus === "offline";
	const isWeak = connectionStatus === "weak";
	const browserOffline = !online;

	// A device that has never reported a level has no reading at all (decision
	// E4): show nothing rather than a made-up 0 % "hopper empty" warning.
	const hopperLevel =
		typeof hopperLevelPct === "number" && Number.isFinite(hopperLevelPct) ? hopperLevelPct : null;

	// 2-decimal doses like "29.63g"
	const feedGrams = Number.parseFloat(nextFeedingVolume.replace("g", ""));
	// Issue #387: the button sends the scheduled dose only up to the effective
	// Feed Now ceiling. A pond configured above the hard ceiling still works,
	// and the dialog states exactly what will be sent.
	const dispenseGrams =
		feedNowLimit && !Number.isNaN(feedGrams)
			? Math.min(feedGrams, feedNowLimit.effectiveG)
			: feedGrams;
	const displayVolume = Number.isNaN(dispenseGrams)
		? nextFeedingVolume
		: `${formatFeedGrams(dispenseGrams)}g`;
	const limited =
		feedNowLimit !== null && !Number.isNaN(feedGrams) && feedGrams > feedNowLimit.effectiveG + 1e-9;
	const limitReasonKey: "limitReasonDaily" | "limitReasonPond" | "limitReasonHard" =
		feedNowLimit?.source === "remaining_daily"
			? "limitReasonDaily"
			: feedNowLimit?.source === "pond_per_meal"
				? "limitReasonPond"
				: "limitReasonHard";
	const dispenseSeconds =
		gramsPerSecond && gramsPerSecond > 0 && dispenseGrams > 0
			? String(Number((dispenseGrams / gramsPerSecond).toFixed(1)))
			: null;

	async function handleFeedNow() {
		setShowConfirm(false);
		if (isOffline || browserOffline || dispenseGrams < 1) return;
		setDispensing(true);
		try {
			// NaN → let the server use the device default
			const result = await requestFeedAction(
				deviceId,
				Number.isNaN(dispenseGrams) ? undefined : dispenseGrams,
			);
			if (result.success && result.message === "Feed already pending") {
				toast.info(t("alreadyQueued"));
			} else if (result.success) {
				toast.success(t("requestSent", { volume: displayVolume }));
			} else {
				toast.error(result.error || t("error"));
			}
		} catch (error) {
			toast.error(t("error"));
		} finally {
			setDispensing(false);
		}
	}

	return (
		<>
			<div className="flex flex-col items-start gap-1">
				<button
					type="button"
					onClick={() => setShowConfirm(true)}
					disabled={
						dispensing || isOffline || browserOffline || !canWrite || isFallow || dispenseGrams < 1
					}
					className="bg-[#E85A2A] text-white font-black text-sm md:text-base px-6 py-3 rounded-2xl hover:bg-[#d04a1f] shadow-lg hover:shadow-xl transition-all transform active:scale-95 flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:shadow-none dark:disabled:bg-gray-700 dark:disabled:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					data-onboard={dataOnboard}
					data-help="feed-now"
				>
					<Activity className={`w-4 h-4 ${dispensing ? "animate-spin" : "animate-pulse"}`} />
					{dispensing ? t("awaitingDevice") : label}
				</button>
				{dispenseSeconds && (
					<p className="text-[11px] font-medium text-[#3D5568] dark:text-gray-400">
						{t("durationHint", { seconds: dispenseSeconds })}
					</p>
				)}
			</div>

			{isOffline && (
				<div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
					<AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
					<p className="text-xs font-medium text-red-700">{t("offlineWarning")}</p>
				</div>
			)}
			{isWeak && (
				<div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
					<AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
					<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
						{t("weakSignalWarning")}
					</p>
				</div>
			)}
			{browserOffline && !isOffline && (
				<div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
					<AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
					<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
						{t("browserOfflineWarning")}
					</p>
				</div>
			)}
			{isFallow && (
				<div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
					<AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
					<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
						{t("fallowWarning")}
					</p>
				</div>
			)}

			{showConfirm && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
					<div className="bg-white rounded-[32px] p-6 md:p-8 max-w-md w-full border border-gray-200 shadow-2xl space-y-6">
						{(isOffline || browserOffline) && (
							<div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
								<AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
								<p className="text-xs text-red-700 font-medium">
									{browserOffline ? t("browserOfflineWarning") : t("offlineWarning")}
								</p>
							</div>
						)}

						{hopperLevel !== null && hopperLevel < 10 && (
							<div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
								<AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
								<p className="text-xs text-red-700 font-medium">
									{t("hopperCritical", { level: hopperLevel })}
								</p>
							</div>
						)}

						{hopperLevel !== null && hopperLevel >= 10 && hopperLevel < 25 && (
							<div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
								<AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
								<p className="text-xs text-amber-700 font-medium">
									{t("hopperLow", { level: hopperLevel })}
								</p>
							</div>
						)}

						<div>
							<h3 className="font-black text-xl md:text-2xl uppercase tracking-tight text-[#C42B3A] mb-2">
								{t("triggerTitle")}
							</h3>
							<p className="text-sm text-[#3D5568] leading-relaxed">
								{t.rich("triggerDesc", {
									volume: displayVolume,
									bold: (chunks) => <strong className="text-[#0A3D62] font-black">{chunks}</strong>,
								})}
							</p>
						</div>
						{feedNowLimit && (
							<p
								data-testid="feed-now-limit-hint"
								className="text-xs leading-relaxed text-[#3D5568] dark:text-gray-300"
							>
								{t("limitHint", {
									limit: formatFeedGrams(feedNowLimit.effectiveG),
									reason: t(limitReasonKey),
								})}{" "}
								{limited && t("limitClamped", { grams: displayVolume })}{" "}
								<Link
									href="/dashboard/settings/pond"
									className="font-bold underline underline-offset-2 text-[#0A3D62] hover:text-[#E85A2A] dark:text-[#8fc0ea]"
								>
									{t("changeInSettings")}
								</Link>
							</p>
						)}
						<div className="bg-[#F4F7F6] p-4 rounded-2xl border border-gray-200 text-xs text-[#3D5568] space-y-1">
							<p>
								{t.rich("feederNode", {
									name: deviceName,
									bold: (chunks) => <strong className="font-mono text-[#0A3D62]">{chunks}</strong>,
								})}
							</p>
							<p>
								{t("connectionLink")}
								<strong
									className={
										isOffline
											? "text-[#C42B3A] font-bold"
											: isWeak
												? "text-[#9A3412] font-bold dark:text-amber-300"
												: "text-[#1E7B34] font-bold"
									}
								>
									{isOffline ? t("offline") : isWeak ? t("weakSignal") : t("connected")}
								</strong>
							</p>
							<p>
								{t.rich("feedPortion", {
									volume: displayVolume,
									bold: (chunks) => (
										<strong className="text-[#E85A2A] font-extrabold">{chunks}</strong>
									),
								})}
							</p>
						</div>
						<div className="flex gap-4">
							<button
								type="button"
								onClick={() => setShowConfirm(false)}
								className="flex-1 bg-[#F4F7F6] text-[#3D5568] font-bold text-sm py-3.5 rounded-xl hover:bg-gray-100 transition-all"
							>
								{tBtn("cancel")}
							</button>
							<button
								type="button"
								onClick={handleFeedNow}
								disabled={browserOffline || dispenseGrams < 1}
								className="flex-1 bg-[#E85A2A] text-white font-extrabold text-sm py-3.5 rounded-xl hover:bg-[#d04a1f] shadow-lg transition-all disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:shadow-none dark:disabled:bg-gray-700 dark:disabled:text-gray-300"
							>
								{tBtn("yesDispenseNow")}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
