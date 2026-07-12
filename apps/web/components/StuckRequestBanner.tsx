"use client";

import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
import { updateScheduleCommand } from "@/lib/actions/schedule";
import { AlertTriangle, BatteryCharging, Cpu, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

interface StuckFeedRequest {
	id: string;
	grams: number;
	createdAt: string;
}

interface StuckScheduleCommand {
	id: string;
	createdAt: string;
}

interface StuckRequestBannerProps {
	stuckFeedRequests: StuckFeedRequest[];
	stuckScheduleCommands: StuckScheduleCommand[];
	deviceOffline: boolean;
	deviceLastSeenAt: string | null;
	deviceId: string;
	pondId: string;
	scheduleStart: string;
	scheduleEnd: string;
	feedsPerDay: number;
	feedingRatePct: number;
}

export function StuckRequestBanner({
	stuckFeedRequests,
	stuckScheduleCommands,
	deviceOffline,
	deviceLastSeenAt,
	deviceId,
	pondId,
	scheduleStart,
	scheduleEnd,
	feedsPerDay,
	feedingRatePct,
}: StuckRequestBannerProps) {
	const t = useTranslations("dashboard.schedule.stuckBanner");
	const [isPendingFeed, startFeedTransition] = useTransition();
	const [isPendingSchedule, startScheduleTransition] = useTransition();

	const fmtTime = (iso: string) => {
		const d = new Date(iso);
		return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	};

	const hasRepeatFeedFailure = stuckFeedRequests.length >= 2;
	const hasSingleFeedFailure = stuckFeedRequests.length === 1;
	const hasStuckSchedule = stuckScheduleCommands.length > 0;

	// Offline trumps all — single banner explaining root cause.
	if (deviceOffline) {
		return (
			<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
				<div className="flex items-start gap-3">
					<WifiOff size={20} className="mt-0.5 shrink-0 text-amber-600" />
					<div className="flex-1">
						<p className="text-sm font-bold text-amber-800">{t("offlineTitle")}</p>
						<p className="mt-1 text-sm text-amber-700">
							{t("offlineDesc", {
								time: deviceLastSeenAt ? fmtTime(deviceLastSeenAt) : "unknown",
							})}
						</p>
					</div>
					<a
						href="/dashboard/app-settings"
						className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-50"
					>
						{t("checkDevice")}
					</a>
				</div>
			</div>
		);
	}

	// Device online — show stuck feed(s) and/or schedule banners, stacked.
	const banners: React.ReactNode[] = [];

	if (hasRepeatFeedFailure) {
		const earliest = (stuckFeedRequests[stuckFeedRequests.length - 1] as StuckFeedRequest)
			.createdAt;
		banners.push(
			<div key="repeat-feed" className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
				<div className="flex items-start gap-3">
					<AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" />
					<div className="flex-1">
						<p className="text-sm font-bold text-red-800">{t("stuckFeedRepeatTitle")}</p>
						<p className="mt-1 text-sm text-red-700">
							{t("stuckFeedRepeatDesc", {
								count: stuckFeedRequests.length,
								time: fmtTime(earliest),
							})}
						</p>
					</div>
					<button
						type="button"
						disabled={isPendingFeed}
						className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
						onClick={() => {
							startFeedTransition(async () => {
								await requestFeedAction(deviceId);
							});
						}}
					>
						{isPendingFeed ? "..." : t("retryFeed")}
					</button>
				</div>
			</div>,
		);
	} else if (hasSingleFeedFailure) {
		const feed = stuckFeedRequests[0] as StuckFeedRequest;
		banners.push(
			<div
				key="single-feed"
				className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"
			>
				<div className="flex items-start gap-3">
					<Cpu size={20} className="mt-0.5 shrink-0 text-amber-600" />
					<div className="flex-1">
						<p className="text-sm font-bold text-amber-800">{t("stuckFeedTitle")}</p>
						<p className="mt-1 text-sm text-amber-700">
							{t("stuckFeedDesc", { time: fmtTime(feed.createdAt) })}
						</p>
					</div>
					<button
						type="button"
						disabled={isPendingFeed}
						className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50"
						onClick={() => {
							startFeedTransition(async () => {
								await requestFeedAction(deviceId);
							});
						}}
					>
						{isPendingFeed ? "..." : t("retryFeed")}
					</button>
				</div>
			</div>,
		);
	}

	if (hasStuckSchedule) {
		const sched = stuckScheduleCommands[0] as StuckScheduleCommand;
		banners.push(
			<div
				key="stuck-schedule"
				className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm"
			>
				<div className="flex items-start gap-3">
					<BatteryCharging size={20} className="mt-0.5 shrink-0 text-blue-600" />
					<div className="flex-1">
						<p className="text-sm font-bold text-blue-800">{t("stuckScheduleTitle")}</p>
						<p className="mt-1 text-sm text-blue-700">
							{t("stuckScheduleDesc", { time: fmtTime(sched.createdAt) })}
						</p>
					</div>
					<button
						type="button"
						disabled={isPendingSchedule}
						className="shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
						onClick={() => {
							startScheduleTransition(async () => {
								await updateScheduleCommand(pondId, deviceId, {
									scheduleStart,
									scheduleEnd,
									feedsPerDay,
									feedingRatePct,
								});
							});
						}}
					>
						{isPendingSchedule ? "..." : "Force Resync"}
					</button>
				</div>
			</div>,
		);
	}

	if (banners.length === 0) return null;

	return <div className="space-y-3">{banners}</div>;
}
