"use client";

import { toggleDevicePause, triggerManualFeed } from "@/lib/actions/schedule";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Pause, Play, Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface ScheduleControlsProps {
	deviceId: string;
	initialIsPaused: boolean;
}

export function ScheduleControls({ deviceId, initialIsPaused }: ScheduleControlsProps) {
	const t = useTranslations("button");
	const [isPaused, setIsPaused] = useState(initialIsPaused);
	const [isPendingPause, startPauseTransition] = useTransition();

	const [showConfirm, setShowConfirm] = useState(false);
	const [isPendingFeed, startFeedTransition] = useTransition();
	const [feedSuccess, setFeedSuccess] = useState(false);

	const handleTogglePause = () => {
		const newStatus = !isPaused;
		setIsPaused(newStatus); // Optimistic update
		startPauseTransition(async () => {
			await toggleDevicePause(deviceId, newStatus);
		});
	};

	const handleFeedNow = () => {
		startFeedTransition(async () => {
			await triggerManualFeed(deviceId);
			setShowConfirm(false);
			setFeedSuccess(true);
			setTimeout(() => setFeedSuccess(false), 3000); // Hide success message after 3s
		});
	};

	return (
		<div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
			{/* Pause / Resume Toggle */}
			<div className="flex items-center gap-4">
				<div
					className={cn(
						"p-3 rounded-full transition-colors",
						isPaused ? "bg-amber-100 text-amber-600" : "bg-green-100 text-green-600",
					)}
				>
					{isPaused ? <Pause size={24} /> : <Play size={24} />}
				</div>
				<div>
					<h3 className="font-semibold text-gray-900 text-lg">
						{isPaused ? "Schedule Paused" : "Schedule Active"}
					</h3>
					<p className="text-sm text-gray-500">
						{isPaused
							? "Automatic feeding is currently suspended."
							: "The feeder is running on the automated schedule."}
					</p>
				</div>
				<button
					type="button"
					onClick={handleTogglePause}
					disabled={isPendingPause}
					className={cn(
						"ml-4 px-4 py-2 rounded-lg font-medium text-sm transition-all border",
						isPaused
							? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
							: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
						isPendingPause && "opacity-50 cursor-not-allowed",
					)}
				>
					{isPendingPause ? (
						<Loader2 size={18} className="animate-spin mx-auto" />
					) : isPaused ? (
						"Resume Schedule"
					) : (
						"Pause Schedule"
					)}
				</button>
			</div>

			{/* Manual Override (Feed Now) */}
			<div className="relative border-t sm:border-t-0 sm:border-l border-gray-100 pt-6 sm:pt-0 sm:pl-6 w-full sm:w-auto flex flex-col items-center">
				{showConfirm ? (
					<div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
						<p className="text-sm text-gray-700 font-medium mb-3">Dispense 500g right now?</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowConfirm(false)}
								className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleFeedNow}
								disabled={isPendingFeed}
								className="px-3 py-1.5 rounded-md text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center justify-center min-w-[80px]"
							>
								{isPendingFeed ? <Loader2 size={16} className="animate-spin" /> : "Confirm"}
							</button>
						</div>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setShowConfirm(true)}
						className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-white bg-[var(--ofd-base)] hover:bg-[#1a4a6e] transition-all shadow-md hover:shadow-lg w-full sm:w-auto justify-center"
					>
						{feedSuccess ? (
							<CheckCircle2 size={20} className="text-green-400" />
						) : (
							<Power size={20} />
						)}
						<span>{feedSuccess ? "Feed Triggered!" : t("feedNow")}</span>
					</button>
				)}
			</div>
		</div>
	);
}
