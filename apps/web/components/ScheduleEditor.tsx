"use client";

import { mobileStickyActions } from "@/components/mobile/form-actions";
import { updateScheduleCommand } from "@/lib/actions/schedule";
import type { UpdateScheduleResult } from "@/lib/actions/schedule";
import { formatFarmDateTime } from "@/lib/date-local";
import { scheduleSlotTimes } from "@/lib/schedule/slots";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface ScheduleCommandInfo {
	id: string;
	status: string;
	scheduleStart: string;
	scheduleEnd: string;
	feedsPerDay: number;
	feedingRatePct: number;
	appliedAt: string | null;
	deviceTime: string | null;
}

interface ScheduleEditorProps {
	pondId: string;
	deviceId: string;
	initialStart: string; // "HH:MM" 24h
	initialEnd: string; // "HH:MM" 24h
	initialFeedsPerDay: number;
	initialFeedingRatePct: number;
	pendingCommand: ScheduleCommandInfo | null;
	latestAppliedCommand: ScheduleCommandInfo | null;
	canWrite?: boolean;
}

function fmtTimeDisplay(hhmm: string): string {
	const [h, m] = hhmm.split(":").map(Number);
	const ampm = h >= 12 ? "PM" : "AM";
	const hr12 = h % 12 || 12;
	return `${hr12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** One row per meal, used by both the live preview and the sync status. */
function FeedTimeList({
	times,
	label,
	testId,
}: {
	times: string[];
	label: string;
	testId: string;
}) {
	if (times.length === 0) return null;

	return (
		<ol aria-label={label} data-testid={testId} className="flex flex-wrap gap-2">
			{times.map((time, index) => (
				<li
					key={`${index}-${time}`}
					data-testid="feed-time-slot"
					className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold tabular-nums text-gray-700 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700/60"
				>
					{fmtTimeDisplay(time)}
				</li>
			))}
		</ol>
	);
}

export function ScheduleEditor({
	pondId,
	deviceId,
	initialStart,
	initialEnd,
	initialFeedsPerDay,
	initialFeedingRatePct,
	pendingCommand,
	latestAppliedCommand,
	canWrite = true,
}: ScheduleEditorProps) {
	const t = useTranslations("dashboard.schedule");
	const tDates = useTranslations("dates");
	const [start, setStart] = useState(initialStart);
	const [end, setEnd] = useState(initialEnd);
	const [feedsPerDay, setFeedsPerDay] = useState(initialFeedsPerDay.toString());
	const [feedingRate, setFeedingRate] = useState(initialFeedingRatePct.toString());
	const [isPending, startTransition] = useTransition();
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const hasPendingChanges = pendingCommand !== null;

	// #431: the displayed times must follow the inputs, not the last command the
	// device applied. Deriving them on every render means changing the frequency
	// from 2 to 3 adds the third row immediately, before the device reconnects.
	const previewSlots = scheduleSlotTimes(start, end, Number.parseInt(feedsPerDay, 10));
	const pendingSlots = pendingCommand
		? scheduleSlotTimes(
				pendingCommand.scheduleStart,
				pendingCommand.scheduleEnd,
				pendingCommand.feedsPerDay,
			)
		: [];
	const appliedSlots = latestAppliedCommand
		? scheduleSlotTimes(
				latestAppliedCommand.scheduleStart,
				latestAppliedCommand.scheduleEnd,
				latestAppliedCommand.feedsPerDay,
			)
		: [];

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(false);

		const feeds = Number.parseInt(feedsPerDay, 10);
		const rate = Number.parseFloat(feedingRate);
		if (Number.isNaN(feeds) || feeds < 1 || feeds > 24) return;
		if (Number.isNaN(rate) || rate < 0) return;

		startTransition(async () => {
			const result: UpdateScheduleResult = await updateScheduleCommand(pondId, deviceId, {
				scheduleStart: start,
				scheduleEnd: end,
				feedsPerDay: feeds,
				feedingRatePct: rate,
			});

			if (result.success) {
				setSuccess(true);
				setTimeout(() => setSuccess(false), 3000);
			} else {
				setError(result.error ?? "Failed to save");
			}
		});
	};

	const handleForceResync = () => {
		setError(null);
		setSuccess(false);

		const feeds = Number.parseInt(feedsPerDay, 10);
		const rate = Number.parseFloat(feedingRate);

		startTransition(async () => {
			const result: UpdateScheduleResult = await updateScheduleCommand(pondId, deviceId, {
				scheduleStart: start,
				scheduleEnd: end,
				feedsPerDay: feeds,
				feedingRatePct: rate,
			});

			if (result.success) {
				setSuccess(true);
				setTimeout(() => setSuccess(false), 3000);
			} else {
				setError(result.error ?? "Failed to resync");
			}
		});
	};

	return (
		<div
			className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden dark:border-gray-700/50 dark:bg-gray-900"
			data-help="schedule-editor"
		>
			<div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-gray-700/50 dark:bg-white/5">
				<h3 className="font-semibold text-gray-900 dark:text-gray-100">{t("editTitle")}</h3>
			</div>

			<form onSubmit={handleSubmit} className="p-6 space-y-6">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div className="flex flex-col gap-2">
						<label
							htmlFor="startTime"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t("startTime")}
						</label>
						<input
							id="startTime"
							type="time"
							value={start}
							onChange={(e) => setStart(e.target.value)}
							className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:[color-scheme:dark]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label
							htmlFor="endTime"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t("endTime")}
						</label>
						<input
							id="endTime"
							type="time"
							value={end}
							onChange={(e) => setEnd(e.target.value)}
							className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:[color-scheme:dark]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label
							htmlFor="feedsPerDay"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t("feedsPerDay")}
						</label>
						<input
							id="feedsPerDay"
							type="number"
							min="1"
							max="24"
							value={feedsPerDay}
							onChange={(e) => setFeedsPerDay(e.target.value)}
							className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:[color-scheme:dark]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label
							htmlFor="feedingRate"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							{t("feedingRate")}
						</label>
						<input
							id="feedingRate"
							type="number"
							step="0.1"
							min="0"
							value={feedingRate}
							onChange={(e) => setFeedingRate(e.target.value)}
							className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:[color-scheme:dark]"
							required
						/>
					</div>
				</div>

				{/* #431: the window and frequency describe the meals; show them as
				    concrete times so a frequency change is visible before saving. */}
				<div
					data-testid="feeding-times-preview"
					className="rounded-2xl border border-gray-100 bg-[#F9FBFA] p-4 dark:border-gray-700/50 dark:bg-gray-800/40"
				>
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<Clock size={16} className="text-[#0A3D62] dark:text-[#5b9bd5]" />
							<span className="text-sm font-bold text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("feedingTimesTitle")}
							</span>
						</div>
						{previewSlots.length > 0 && (
							<span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
								{t("timesPerDay", { count: previewSlots.length })}
							</span>
						)}
					</div>
					{previewSlots.length > 0 ? (
						<FeedTimeList
							times={previewSlots}
							label={t("feedingTimesLabel")}
							testId="preview-feed-times"
						/>
					) : (
						<p className="text-xs text-gray-500 dark:text-gray-400">{t("feedingTimesInvalid")}</p>
					)}
				</div>

				{/* Sync Status Card */}
				<div className="rounded-2xl border border-gray-100 bg-[#F4F7F6] p-4 dark:border-gray-700/50 dark:bg-gray-800/60">
					<div className="flex items-center gap-2 mb-3">
						<RefreshCw size={16} className="text-[#0A3D62] dark:text-[#5b9bd5]" />
						<span className="text-sm font-bold text-[#0A3D62] dark:text-[#5b9bd5]">
							{t("syncStatus")}
						</span>
					</div>

					{hasPendingChanges ? (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<Clock size={16} className="text-amber-500" />
								<span className="text-amber-700 font-semibold dark:text-amber-300">
									{t("syncPending")}
								</span>
							</div>
							{pendingCommand && (
								<div className="text-xs text-gray-500 ml-6 dark:text-gray-400">
									{pendingCommand.scheduleStart !== start ||
									pendingCommand.scheduleEnd !== end ||
									pendingCommand.feedsPerDay !== Number(feedsPerDay) ||
									pendingCommand.feedingRatePct !== Number(feedingRate) ? (
										<span>
											{t("syncPendingValues", {
												start: fmtTimeDisplay(pendingCommand.scheduleStart),
												end: fmtTimeDisplay(pendingCommand.scheduleEnd),
												feeds: pendingCommand.feedsPerDay,
											})}
										</span>
									) : (
										<span>{t("syncPendingSame")}</span>
									)}
								</div>
							)}
							{pendingSlots.length > 0 && (
								<div className="ml-6">
									<FeedTimeList
										times={pendingSlots}
										label={t("feedingTimesLabel")}
										testId="pending-feed-times"
									/>
								</div>
							)}
						</div>
					) : latestAppliedCommand ? (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<CheckCircle2 size={16} className="text-green-500" />
								<span className="text-green-700 font-semibold dark:text-green-400">
									{t("syncApplied", {
										time: latestAppliedCommand.appliedAt
											? formatFarmDateTime(new Date(latestAppliedCommand.appliedAt), tDates).time
											: (latestAppliedCommand.deviceTime ?? t("unknownDeviceTime")),
									})}
								</span>
							</div>
							<div className="text-xs text-gray-500 ml-6 dark:text-gray-400">
								{fmtTimeDisplay(latestAppliedCommand.scheduleStart)} -{" "}
								{fmtTimeDisplay(latestAppliedCommand.scheduleEnd)},
								{latestAppliedCommand.feedsPerDay} feeds/day
							</div>
							{appliedSlots.length > 0 && (
								<div className="ml-6">
									<FeedTimeList
										times={appliedSlots}
										label={t("feedingTimesLabel")}
										testId="applied-feed-times"
									/>
								</div>
							)}
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
							<CheckCircle2 size={16} className="text-gray-400 dark:text-gray-500" />
							<span>{t("syncNone")}</span>
						</div>
					)}

					<button
						type="button"
						onClick={handleForceResync}
						disabled={isPending || !canWrite}
						className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 bg-white px-3 py-1.5 text-xs font-bold text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/5 disabled:opacity-50 dark:border-[#5b9bd5]/30 dark:bg-gray-900 dark:text-[#5b9bd5] dark:hover:bg-white/10"
					>
						{isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						{t("forceResync")}
					</button>
				</div>

				{/* #275: the card clips its overflow, so it is the sticky row's
				    scrollport and the row's bottom offset pulls it up over the
				    sync card. This mobile-only spacer gives the row empty space
				    to cover instead, keeping the sync card fully tappable. */}
				<div aria-hidden="true" className="h-20 sm:hidden" />

				<div className={cn("flex items-center gap-4", mobileStickyActions)}>
					<button
						type="submit"
						disabled={isPending || !canWrite}
						data-help="schedule-save"
						className="flex min-h-[44px] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{isPending ? <Loader2 size={18} className="animate-spin" /> : t("saveChanges")}
					</button>
					{success && (
						<span className="flex items-center gap-1 text-sm font-medium text-green-600 animate-in fade-in dark:text-green-400">
							<CheckCircle2 size={16} />
							{t("saved")}
						</span>
					)}
					{error && (
						<span className="flex items-center gap-1 text-sm font-medium text-red-600 animate-in fade-in dark:text-red-400">
							<XCircle size={16} />
							{error}
						</span>
					)}
				</div>
			</form>
		</div>
	);
}
