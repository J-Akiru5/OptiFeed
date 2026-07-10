"use client";

import { triggerManualFeed } from "@/lib/actions/schedule";
import { Activity } from "lucide-react";
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
	const [dispensing, setDispensing] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);

	async function handleFeedNow() {
		setDispensing(true);
		setShowConfirm(false);
		try {
			await triggerManualFeed(deviceId);
			toast.success(`Successfully dispensed ${nextFeedingVolume} of feed!`);
		} catch (error) {
			toast.error("Failed to trigger manual feed.");
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
								Trigger Manual Feeding?
							</h3>
							<p className="text-sm text-[#3D5568] leading-relaxed">
								This will send an immediate auger motor manual override request of{" "}
								<strong className="text-[#0A3D62] font-black">{nextFeedingVolume}</strong> directly
								to the physical ESP32 automatic feeder controller.
							</p>
						</div>
						<div className="bg-[#F4F7F6] p-4 rounded-2xl border border-gray-200 text-xs text-[#3D5568] space-y-1">
							<p>
								📍 Feeder Node: <strong className="font-mono text-[#0A3D62]">{deviceName}</strong>
							</p>
							<p>
								📍 Connection Link:{" "}
								<strong
									className={
										connectionStatus === "online"
											? "text-[#1E7B34] font-bold"
											: "text-[#C42B3A] font-bold"
									}
								>
									{connectionStatus === "online" ? "Connected • RSSI −58dB" : "Offline"}
								</strong>
							</p>
							<p>
								📍 Feed Portion:{" "}
								<strong className="text-[#E85A2A] font-extrabold">
									{nextFeedingVolume} of 4mm pellets
								</strong>
							</p>
						</div>
						<div className="flex gap-4">
							<button
								type="button"
								onClick={() => setShowConfirm(false)}
								className="flex-1 bg-[#F4F7F6] text-[#3D5568] font-bold text-sm py-3.5 rounded-xl hover:bg-gray-100 transition-all"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleFeedNow}
								className="flex-1 bg-[#E85A2A] text-white font-extrabold text-sm py-3.5 rounded-xl hover:bg-[#d04a1f] shadow-lg transition-all"
							>
								Yes, Dispense Now
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
