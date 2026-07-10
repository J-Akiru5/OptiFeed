"use client";

import { triggerManualFeed } from "@/lib/actions/schedule";
import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface FeedNowButtonProps {
	deviceId: string;
	nextFeedingVolume: string;
	label: string;
	deviceName?: string;
	connectionStatus?: string;
}

export function FeedNowButton({
	deviceId,
	nextFeedingVolume,
	label,
	deviceName = "ILO-POND-01",
	connectionStatus = "online",
}: FeedNowButtonProps) {
	const t = useTranslations("feedNowModal");
	const tBtn = useTranslations("button");

	const [dispensing, setDispensing] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);

	async function handleFeedNow() {
		setDispensing(true);
		setShowConfirm(false);
		try {
			await triggerManualFeed(deviceId);
			toast.success(t("success", { volume: nextFeedingVolume }));
		} catch (error) {
			toast.error(t("error"));
		} finally {
			setDispensing(false);
		}
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setShowConfirm(true)}
				disabled={dispensing}
				className="bg-[#E85A2A] text-white font-black text-sm md:text-base px-6 py-3 rounded-2xl hover:bg-[#d04a1f] shadow-lg hover:shadow-xl transition-all transform active:scale-95 flex items-center gap-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
			>
				<Activity className={`w-4 h-4 ${dispensing ? "animate-spin" : "animate-pulse"}`} /> {label}
			</button>

			{showConfirm && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
					<div className="bg-white rounded-[32px] p-6 md:p-8 max-w-md w-full border border-gray-200 shadow-2xl space-y-6">
						<div>
							<h3 className="font-black text-xl md:text-2xl uppercase tracking-tight text-[#C42B3A] mb-2">
								{t("triggerTitle")}
							</h3>
							<p
								className="text-sm text-[#3D5568] leading-relaxed"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Controlled translation string
								dangerouslySetInnerHTML={{
									__html: t("triggerDesc", { volume: nextFeedingVolume }),
								}}
							/>
						</div>
						<div className="bg-[#F4F7F6] p-4 rounded-2xl border border-gray-200 text-xs text-[#3D5568] space-y-1">
							<p
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Controlled translation string
								dangerouslySetInnerHTML={{
									__html: t("feederNode", { name: deviceName }),
								}}
							/>
							<p>
								{t("connectionLink")}
								<strong
									className={
										connectionStatus === "online"
											? "text-[#1E7B34] font-bold"
											: "text-[#C42B3A] font-bold"
									}
								>
									{connectionStatus === "online" ? t("connected") : t("offline")}
								</strong>
							</p>
							<p
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Controlled translation string
								dangerouslySetInnerHTML={{
									__html: t("feedPortion", { volume: nextFeedingVolume }),
								}}
							/>
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
								className="flex-1 bg-[#E85A2A] text-white font-extrabold text-sm py-3.5 rounded-xl hover:bg-[#d04a1f] shadow-lg transition-all"
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
