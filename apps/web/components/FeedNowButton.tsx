"use client";

import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
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
	hopperLevelPct?: number;
	canWrite?: boolean;
	isFallow?: boolean;
	gramsPerSecond?: number;
	"data-onboard"?: string;
}

export function FeedNowButton({
	deviceId,
	nextFeedingVolume,
	label,
	deviceName = "ILO-POND-01",
	connectionStatus = "online",
	hopperLevelPct = 100,
	canWrite = true,
	isFallow = false,
	gramsPerSecond,
	"data-onboard": dataOnboard,
}: FeedNowButtonProps) {
	const t = useTranslations("dashboard.feedNowModal");
	const tBtn = useTranslations("button");

	const [dispensing, setDispensing] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);
	const online = useOnlineStatus();

	const isOffline = connectionStatus === "offline";
	const browserOffline = !online;

	// 2-decimal doses like "29.63g"
	const feedGrams = Number.parseFloat(nextFeedingVolume.replace("g", ""));
	const dispenseSeconds =
		gramsPerSecond && gramsPerSecond > 0 && !Number.isNaN(feedGrams) && feedGrams > 0
			? String(Number((feedGrams / gramsPerSecond).toFixed(1)))
			: null;

	async function handleFeedNow() {
		setShowConfirm(false);
		if (isOffline || browserOffline) return;
		setDispensing(true);
		try {
			// NaN → let the server use the device default
			const result = await requestFeedAction(
				deviceId,
				Number.isNaN(feedGrams) ? undefined : feedGrams,
			);
			if (result.success && result.message === "Feed already pending") {
				toast.info(t("alreadyQueued"));
			} else if (result.success) {
				toast.success(t("requestSent", { volume: nextFeedingVolume }));
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
					disabled={dispensing || isOffline || browserOffline || !canWrite || isFallow}
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

						{hopperLevelPct < 10 && (
							<div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
								<AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
								<p className="text-xs text-red-700 font-medium">
									{t("hopperCritical", { level: hopperLevelPct })}
								</p>
							</div>
						)}

						{hopperLevelPct >= 10 && hopperLevelPct < 25 && (
							<div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
								<AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
								<p className="text-xs text-amber-700 font-medium">
									{t("hopperLow", { level: hopperLevelPct })}
								</p>
							</div>
						)}

						<div>
							<h3 className="font-black text-xl md:text-2xl uppercase tracking-tight text-[#C42B3A] mb-2">
								{t("triggerTitle")}
							</h3>
							<p className="text-sm text-[#3D5568] leading-relaxed">
								{t.rich("triggerDesc", {
									volume: nextFeedingVolume,
									bold: (chunks) => <strong className="text-[#0A3D62] font-black">{chunks}</strong>,
								})}
							</p>
						</div>
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
									className={!isOffline ? "text-[#1E7B34] font-bold" : "text-[#C42B3A] font-bold"}
								>
									{!isOffline ? t("connected") : t("offline")}
								</strong>
							</p>
							<p>
								{t.rich("feedPortion", {
									volume: nextFeedingVolume,
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
								disabled={browserOffline}
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
