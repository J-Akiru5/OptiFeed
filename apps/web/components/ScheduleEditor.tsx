"use client";

import { updateScheduleCommand } from "@/lib/actions/schedule";
import type { UpdateScheduleResult } from "@/lib/actions/schedule";
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
}

function fmtTimeFromDate(d: Date): string {
	return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtTimeDisplay(hhmm: string): string {
	const [h, m] = hhmm.split(":").map(Number);
	const ampm = h >= 12 ? "PM" : "AM";
	const hr12 = h % 12 || 12;
	return `${hr12}:${String(m).padStart(2, "0")} ${ampm}`;
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
}: ScheduleEditorProps) {
	const t = useTranslations("dashboard.schedule");
	const [start, setStart] = useState(initialStart);
	const [end, setEnd] = useState(initialEnd);
	const [feedsPerDay, setFeedsPerDay] = useState(initialFeedsPerDay.toString());
	const [feedingRate, setFeedingRate] = useState(initialFeedingRatePct.toString());
	const [isPending, startTransition] = useTransition();
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const hasPendingChanges = pendingCommand !== null;
	const hasPendingFromDifferentValues =
		pendingCommand &&
		(pendingCommand.scheduleStart !== start ||
			pendingCommand.scheduleEnd !== end ||
			pendingCommand.feedsPerDay !== Number(feedsPerDay) ||
			pendingCommand.feedingRatePct !== Number(feedingRate));

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
		<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
			<div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
				<h3 className="font-semibold text-gray-900">{t("editTitle")}</h3>
			</div>

			<form onSubmit={handleSubmit} className="p-6 space-y-6">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div className="flex flex-col gap-2">
						<label htmlFor="startTime" className="text-sm font-medium text-gray-700">
							{t("startTime")}
						</label>
						<input
							id="startTime"
							type="time"
							value={start}
							onChange={(e) => setStart(e.target.value)}
							className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="endTime" className="text-sm font-medium text-gray-700">
							{t("endTime")}
						</label>
						<input
							id="endTime"
							type="time"
							value={end}
							onChange={(e) => setEnd(e.target.value)}
							className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="feedsPerDay" className="text-sm font-medium text-gray-700">
							{t("feedsPerDay")}
						</label>
						<input
							id="feedsPerDay"
							type="number"
							min="1"
							max="24"
							value={feedsPerDay}
							onChange={(e) => setFeedsPerDay(e.target.value)}
							className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							required
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="feedingRate" className="text-sm font-medium text-gray-700">
							{t("feedingRate")}
						</label>
						<input
							id="feedingRate"
							type="number"
							step="0.1"
							min="0"
							value={feedingRate}
							onChange={(e) => setFeedingRate(e.target.value)}
							className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							required
						/>
					</div>
				</div>

				{/* Sync Status Card */}
				<div className="rounded-2xl border border-gray-100 bg-[#F4F7F6] p-4">
					<div className="flex items-center gap-2 mb-3">
						<RefreshCw size={16} className="text-[#0A3D62]" />
						<span className="text-sm font-bold text-[#0A3D62]">{t("syncStatus")}</span>
					</div>

					{hasPendingChanges ? (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<Clock size={16} className="text-amber-500" />
								<span className="text-amber-700 font-semibold">{t("syncPending")}</span>
							</div>
							{pendingCommand && (
								<div className="text-xs text-gray-500 ml-6">
									{pendingCommand.scheduleStart !== start ||
									pendingCommand.scheduleEnd !== end ||
									pendingCommand.feedsPerDay !== Number(feedsPerDay) ||
									pendingCommand.feedingRatePct !== Number(feedingRate) ? (
										<span>
											Pending: {fmtTimeDisplay(pendingCommand.scheduleStart)} -{" "}
											{fmtTimeDisplay(pendingCommand.scheduleEnd)},{pendingCommand.feedsPerDay}{" "}
											feeds/day
										</span>
									) : (
										<span>Same values queued for resync</span>
									)}
								</div>
							)}
						</div>
					) : latestAppliedCommand ? (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<CheckCircle2 size={16} className="text-green-500" />
								<span className="text-green-700 font-semibold">
									{t("syncApplied", {
										time: latestAppliedCommand.appliedAt
											? new Date(latestAppliedCommand.appliedAt).toLocaleTimeString()
											: (latestAppliedCommand.deviceTime ?? "unknown"),
									})}
								</span>
							</div>
							<div className="text-xs text-gray-500 ml-6">
								{fmtTimeDisplay(latestAppliedCommand.scheduleStart)} -{" "}
								{fmtTimeDisplay(latestAppliedCommand.scheduleEnd)},
								{latestAppliedCommand.feedsPerDay} feeds/day
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-gray-600">
							<CheckCircle2 size={16} className="text-gray-400" />
							<span>{t("syncNone")}</span>
						</div>
					)}

					<button
						type="button"
						onClick={handleForceResync}
						disabled={isPending}
						className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 bg-white px-3 py-1.5 text-xs font-bold text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/5 disabled:opacity-50"
					>
						{isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						{t("forceResync")}
					</button>
				</div>

				<div className="flex items-center gap-4">
					<button
						type="submit"
						disabled={isPending}
						className="flex min-h-[44px] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{isPending ? <Loader2 size={18} className="animate-spin" /> : t("saveChanges")}
					</button>
					{success && (
						<span className="flex items-center gap-1 text-sm font-medium text-green-600 animate-in fade-in">
							<CheckCircle2 size={16} />
							{t("saved")}
						</span>
					)}
					{error && (
						<span className="flex items-center gap-1 text-sm font-medium text-red-600 animate-in fade-in">
							<XCircle size={16} />
							{error}
						</span>
					)}
				</div>
			</form>
		</div>
	);
}
