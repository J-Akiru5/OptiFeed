"use client";

import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
import { toggleDevicePause } from "@/lib/actions/schedule";
import { useFeedCommandGuard } from "@/lib/pwa/use-feed-guard";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface ScheduleControlsProps {
	deviceId: string;
	initialIsPaused: boolean;
	gramsPerFeeding?: number;
	gramsPerSecond?: number;
	canWrite?: boolean;
}

export function ScheduleControls({
	deviceId,
	initialIsPaused,
	gramsPerFeeding = 150,
	gramsPerSecond,
	canWrite = true,
}: ScheduleControlsProps) {
	const tBtn = useTranslations("button");
	const tSch = useTranslations("dashboard.schedule");
	const tModal = useTranslations("dashboard.feedNowModal");
	const { online, reason, blockIfOffline } = useFeedCommandGuard();
	const [isPaused, setIsPaused] = useState(initialIsPaused);
	const [isPendingPause, startPauseTransition] = useTransition();

	const [showConfirm, setShowConfirm] = useState(false);
	const [isPendingFeed, startFeedTransition] = useTransition();
	const [feedSuccess, setFeedSuccess] = useState(false);

	const feedGramsLabel = String(Number(gramsPerFeeding.toFixed(1)));
	const feedDurationSeconds =
		gramsPerSecond && gramsPerSecond > 0 && gramsPerFeeding > 0
			? String(Number((gramsPerFeeding / gramsPerSecond).toFixed(1)))
			: null;

	const handleTogglePause = () => {
		if (blockIfOffline()) return;
		const newStatus = !isPaused;
		setIsPaused(newStatus); // Optimistic update
		startPauseTransition(async () => {
			await toggleDevicePause(deviceId, newStatus);
		});
	};

	const handleFeedNow = () => {
		if (blockIfOffline()) return;
		startFeedTransition(async () => {
			try {
				const result = await requestFeedAction(deviceId, gramsPerFeeding);
				if (result.success) {
					if (result.message === "Feed already pending") {
						toast.info(tModal("alreadyQueued"));
					} else {
						toast.success(tModal("requestSent", { volume: `${gramsPerFeeding}g` }));
					}
					setShowConfirm(false);
					setFeedSuccess(true);
					setTimeout(() => setFeedSuccess(false), 3000);
				} else {
					toast.error(tModal("error"));
				}
			} catch {
				toast.error(tModal("error"));
			}
		});
	};

	return (
		<div
			className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-6 dark:border-gray-700/50 dark:bg-gray-900"
			data-help="schedule-controls"
		>
			{/* Pause / Resume Toggle */}
			<div className="flex items-center gap-4">
				<div
					className={cn(
						"p-3 rounded-full transition-colors",
						isPaused
							? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
							: "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300",
					)}
				>
					{isPaused ? <Pause size={24} /> : <Play size={24} />}
				</div>
				<div>
					<h3 className="font-semibold text-gray-900 text-lg dark:text-gray-100">
						{isPaused ? tSch("pausedStatus") : tSch("activeStatus")}
					</h3>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						{isPaused ? tSch("pausedDesc") : tSch("activeDesc")}
					</p>
				</div>
				<button
					type="button"
					onClick={handleTogglePause}
					disabled={isPendingPause || !canWrite || !online}
					title={reason}
					className={cn(
						"ml-4 px-4 py-2 rounded-lg font-medium text-sm transition-all border",
						isPaused
							? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/20"
							: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20",
						isPendingPause && "opacity-50 cursor-not-allowed",
					)}
				>
					{isPendingPause ? (
						<Loader2 size={18} className="animate-spin mx-auto" />
					) : isPaused ? (
						tBtn("resumeSchedule")
					) : (
						tBtn("pauseSchedule")
					)}
				</button>
			</div>

			{/* Manual Override (Feed Now) */}
			<div className="relative border-t sm:border-t-0 sm:border-l border-gray-100 pt-6 sm:pt-0 sm:pl-6 w-full sm:w-auto flex flex-col items-center dark:border-gray-700/50">
				{showConfirm ? (
					<div className="flex flex-col items-center animate-in fade-in zoom-in duration-200">
						<p className="text-sm text-gray-700 font-medium mb-3 dark:text-gray-300">
							{tSch("dispensePrompt")}
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowConfirm(false)}
								className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
							>
								{tBtn("cancel")}
							</button>
							<button
								type="button"
								onClick={handleFeedNow}
								disabled={isPendingFeed || !online}
								title={reason}
								className="px-3 py-1.5 rounded-md text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center justify-center min-w-[80px]"
							>
								{isPendingFeed ? <Loader2 size={16} className="animate-spin" /> : tBtn("confirm")}
							</button>
						</div>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setShowConfirm(true)}
						disabled={!canWrite || !online}
						title={reason}
						className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-white bg-[var(--ofd-base)] hover:bg-[#1a4a6e] transition-all shadow-md hover:shadow-lg w-full sm:w-auto justify-center disabled:opacity-50 dark:bg-[#1f66a0] dark:hover:bg-[#2a7ab8]"
					>
						{feedSuccess ? (
							<CheckCircle2 size={20} className="text-green-400" />
						) : (
							<Power size={20} />
						)}
						<span>{feedSuccess ? tBtn("feedTriggered") : tBtn("feedNow")}</span>
					</button>
				)}
				{reason && (
					<p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
						<AlertTriangle size={12} aria-hidden="true" />
						{reason}
					</p>
				)}
				{feedDurationSeconds && (
					<p className="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
						{tSch("feedDurationHint", {
							grams: feedGramsLabel,
							seconds: feedDurationSeconds,
						})}
					</p>
				)}
			</div>
		</div>
	);
}
