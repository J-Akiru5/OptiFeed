"use client";

import { Link } from "@/i18n/routing";
import { requestFeed as requestFeedAction } from "@/lib/actions/energy";
import { type FeedNowLimit, formatFeedGrams } from "@/lib/limits-core";
import { useFeedCommandGuard } from "@/lib/pwa/use-feed-guard";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	Box,
	CalendarClock,
	Clock,
	Loader2,
	Utensils,
	Wifi,
	WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface EnergyControllerCardProps {
	deviceId: string;
	label: string;
	mac: string;
	rtcOk: boolean;
	feederActive: boolean;
	gramsPerFeeding: number;
	gramsPerSecond?: number;
	lastSeenAt: Date | null;
	isOffline: boolean;
	canWrite?: boolean;
	/** True when lastCalibratedAt + the device interval has passed. */
	recalibrationDue?: boolean;
	recalibrationDaysOverdue?: number;
	/** Effective Feed Now ceiling (issue #387). */
	feedNowLimit?: FeedNowLimit | null;
}

function formatLastSeen(lastSeenAt: Date | null): string {
	if (!lastSeenAt) return "Never";
	const seconds = Math.floor((Date.now() - lastSeenAt.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export function EnergyControllerCard({
	deviceId,
	label,
	mac,
	rtcOk,
	feederActive,
	gramsPerFeeding,
	gramsPerSecond,
	lastSeenAt,
	isOffline,
	canWrite = true,
	recalibrationDue = false,
	recalibrationDaysOverdue = 0,
	feedNowLimit = null,
}: EnergyControllerCardProps) {
	const initialFeedGrams =
		Number.isFinite(gramsPerFeeding) && gramsPerFeeding > 0 ? gramsPerFeeding : 150;
	const [feedGrams, setFeedGrams] = useState(() =>
		Math.min(initialFeedGrams, feedNowLimit?.effectiveG ?? initialFeedGrams),
	);
	const [isPending, startTransition] = useTransition();
	const [feedSent, setFeedSent] = useState(false);
	const [alreadyQueued, setAlreadyQueued] = useState(false);
	const { online, reason, blockIfOffline } = useFeedCommandGuard();
	const tViewer = useTranslations("dashboard.feederViewer");
	const tLimit = useTranslations("dashboard.feedNowModal");

	const maxFeedGrams = feedNowLimit ? Math.max(1, Math.floor(feedNowLimit.effectiveG)) : 500;
	const overLimit = feedNowLimit !== null && feedGrams > feedNowLimit.effectiveG + 1e-9;
	const limitReasonKey: "limitReasonDaily" | "limitReasonPond" | "limitReasonHard" =
		feedNowLimit?.source === "remaining_daily"
			? "limitReasonDaily"
			: feedNowLimit?.source === "pond_per_meal"
				? "limitReasonPond"
				: "limitReasonHard";

	const dispenseSeconds =
		gramsPerSecond && gramsPerSecond > 0 && feedGrams > 0
			? String(Number((feedGrams / gramsPerSecond).toFixed(1)))
			: null;

	const handleFeedNow = () => {
		if (blockIfOffline()) return;
		setFeedSent(false);
		setAlreadyQueued(false);
		startTransition(async () => {
			const result = await requestFeedAction(deviceId, feedGrams);
			if (result.success) {
				if (result.message === "Feed already pending") {
					setAlreadyQueued(true);
					setTimeout(() => setAlreadyQueued(false), 3000);
				} else {
					setFeedSent(true);
					setTimeout(() => setFeedSent(false), 3000);
				}
			} else {
				toast.error(result.error || "Failed to create feed request");
			}
		});
	};

	return (
		<div className="@container rounded-3xl bg-white dark:bg-gray-900 p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 transition-shadow hover:shadow-md min-w-0">
			<div className="flex items-center justify-between mb-5">
				<div className="flex items-center gap-3">
					<div className="h-11 w-11 rounded-xl bg-[var(--ofd-base)]/10 text-[var(--ofd-base)] flex items-center justify-center">
						<Utensils className="h-6 w-6" />
					</div>
					<div>
						<p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							ESP32 Controller
						</p>
						<h3 className="text-lg font-bold text-[var(--ofd-base-deep)]">{label}</h3>
						{recalibrationDue && (
							<Link
								href="/dashboard/settings/hardware"
								className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
							>
								<CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
								{recalibrationDaysOverdue > 0
									? `Recalibration due · ${recalibrationDaysOverdue}d overdue`
									: "Recalibration due"}
							</Link>
						)}
					</div>
				</div>
				<span
					className={cn(
						"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
						isOffline
							? "bg-red-100 text-red-700"
							: feederActive
								? "bg-green-100 text-green-700"
								: "bg-gray-100 text-gray-600",
					)}
				>
					<span
						className={cn(
							"h-2 w-2 rounded-full",
							isOffline
								? "bg-red-500"
								: feederActive
									? "bg-green-500 animate-pulse"
									: "bg-gray-400",
						)}
					/>
					{isOffline ? "Offline" : feederActive ? "Feeding..." : "Idle"}
				</span>
			</div>

			{isOffline && (
				<div className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
					<AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
					<p className="text-xs text-red-700 dark:text-red-300 font-medium">
						Device offline — last seen {formatLastSeen(lastSeenAt)}. Dashboard feed requests are
						rejected while offline; device-scheduled and physical button feeds still work.
					</p>
				</div>
			)}

			{/* #269: the two-column split follows the card's own width. At a 1280 px
			    viewport the old `lg:` rule halved this card inside the 22 rem rail,
			    which squeezed the mono MAC address past the card edge. */}
			<div className="grid gap-6 @xl:grid-cols-2">
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="flex min-w-0 items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							{rtcOk ? (
								<Wifi className="h-4 w-4 text-green-500" />
							) : (
								<WifiOff className="h-4 w-4 text-red-500" />
							)}
							<div className="min-w-0">
								<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">RTC</p>
								<p className={cn("text-sm font-medium", rtcOk ? "text-green-600" : "text-red-600")}>
									{rtcOk ? "OK" : "Offline"}
								</p>
							</div>
						</div>
						<div className="flex min-w-0 items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<Clock className="h-4 w-4 text-gray-400 dark:text-gray-500" />
							<div className="min-w-0">
								<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Last seen</p>
								<p className="text-sm text-gray-700 dark:text-gray-200">
									{formatLastSeen(lastSeenAt)}
								</p>
							</div>
						</div>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gray-50 dark:bg-gray-800 p-4">
						<div className="min-w-0">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">MAC Address</p>
							<p className="text-sm font-mono break-all text-gray-700 dark:text-gray-200">{mac}</p>
						</div>
						<div className="text-right">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Default Feed</p>
							<p className="text-sm font-medium text-gray-700 dark:text-gray-200">
								{gramsPerFeeding}g
							</p>
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<div>
						<div className="mb-1 flex items-baseline justify-between gap-2">
							<label
								htmlFor="feed-grams"
								className="block text-xs text-gray-500 dark:text-gray-400 font-medium"
							>
								Feed Amount (grams)
							</label>
							{dispenseSeconds && (
								<span className="text-[11px] text-gray-500 dark:text-gray-400">
									≈ {dispenseSeconds}s dispense
								</span>
							)}
						</div>
						<input
							id="feed-grams"
							type="number"
							min={1}
							max={maxFeedGrams}
							value={feedGrams}
							onChange={(e) => setFeedGrams(Number(e.target.value))}
							aria-describedby={feedNowLimit ? "feed-now-limit-hint" : undefined}
							aria-invalid={overLimit}
							className="w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--ofd-base)]/30 focus:border-[var(--ofd-base)]"
						/>
						{feedNowLimit && (
							<p
								id="feed-now-limit-hint"
								className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400"
							>
								{tLimit("limitHint", {
									limit: formatFeedGrams(feedNowLimit.effectiveG),
									reason: tLimit(limitReasonKey),
								})}{" "}
								<Link
									href="/dashboard/settings/pond"
									className="font-semibold underline underline-offset-2 text-[#0A3D62] hover:text-[#E85A2A] dark:text-[#8fc0ea]"
								>
									{tLimit("changeInSettings")}
								</Link>
							</p>
						)}
					</div>

					<button
						type="button"
						onClick={handleFeedNow}
						disabled={
							isPending || feederActive || feedGrams <= 0 || isOffline || !canWrite || !online
						}
						title={reason}
						className={cn(
							"flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 font-medium text-white transition-all shadow-md hover:shadow-lg disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none dark:disabled:bg-gray-700 dark:disabled:text-gray-400",
							alreadyQueued
								? "bg-amber-500 hover:bg-amber-600"
								: feedSent
									? "bg-green-500 hover:bg-green-600"
									: "bg-[var(--ofd-base)] hover:bg-[#1a4a6e]",
						)}
					>
						{isPending ? (
							<Loader2 className="h-5 w-5 animate-spin" />
						) : (
							<Utensils className="h-5 w-5" />
						)}
						<span>
							{alreadyQueued
								? "Already Queued"
								: feedSent
									? "Feed Request Sent!"
									: feederActive
										? "Feeding in Progress..."
										: `Feed Now (${feedGrams}g)`}
						</span>
					</button>
					{reason && (
						<p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
							<AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
							{reason}
						</p>
					)}
				</div>
			</div>

			<div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
				<Link
					href={`/dashboard/devices/${deviceId}`}
					className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-[#8fc0ea] dark:focus-visible:ring-[#8fc0ea]"
				>
					<Box aria-hidden="true" className="size-3.5" />
					{tViewer("openViewer")}
				</Link>
			</div>
		</div>
	);
}
