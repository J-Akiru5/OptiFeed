"use client";

import { formatFarmDateTime } from "@/lib/date-local";
import { getFeedLevelDisplay } from "@/lib/feed-level";
import { isHopperLowDisplay } from "@/lib/feed-level-display";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface FeedLevelCardProps {
	levelPercent: number | null;
	updatedAt: Date | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	feedsPerDay: number;
	isDeviceOffline?: boolean;
}

export function FeedLevelCard({
	levelPercent,
	updatedAt,
	hopperCapacityG,
	gramsPerFeeding,
	feedsPerDay,
	isDeviceOffline = false,
}: FeedLevelCardProps) {
	const t = useTranslations("dashboard.feedLevel");
	const tDates = useTranslations("dates");
	const { state, percent, readingAt, hasReading, isCritical, isLow, daysRemaining } =
		getFeedLevelDisplay({
			levelPercent,
			updatedAt,
			isDeviceOffline,
			hopperCapacityG,
			gramsPerFeeding,
			feedsPerDay,
		});

	const isStale = state === "stale";
	// #259: the display threshold is 30 %, independent of the org's alert
	// threshold (`hopperLowPct`, default 20). Only a live reading can blink:
	// an offline device keeps its greyed last-known treatment.
	const isLowDisplay = state === "live" && isHopperLowDisplay(levelPercent);
	const readingTime = readingAt ? formatFarmDateTime(readingAt, tDates) : null;
	const readingLabel = readingTime
		? t("readingTime", { date: readingTime.date, time: readingTime.time })
		: t("unknownTime");

	const barColor = isStale
		? "bg-gray-400"
		: isCritical || isLowDisplay
			? "bg-red-500"
			: isLow
				? "bg-amber-500"
				: "bg-emerald-500";

	const badgeTone = isStale
		? "bg-gray-100 text-[#3D5568] dark:bg-gray-800 dark:text-gray-300"
		: isCritical || isLowDisplay
			? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
			: isLow
				? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
				: hasReading
					? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
					: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
	const dotTone = isStale
		? "bg-gray-400"
		: isCritical || isLowDisplay
			? "bg-red-500"
			: isLow
				? "bg-amber-500"
				: hasReading
					? "bg-green-500"
					: "bg-gray-400";
	const badgeLabel = isStale
		? t("offline")
		: isCritical
			? t("empty")
			: isLowDisplay
				? t("lowRefill")
				: isLow
					? t("low")
					: hasReading
						? t("ok")
						: t("noData");

	return (
		<div
			className={cn(
				"rounded-3xl bg-white dark:bg-gray-900 p-6 shadow-sm border transition-shadow hover:shadow-md",
				isLowDisplay
					? "border-red-300 dark:border-red-900/60"
					: "border-gray-100 dark:border-gray-700/50",
			)}
			data-help="dashboard-hopper"
			data-hopper-low={isLowDisplay ? "true" : undefined}
		>
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<div className="h-11 w-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
						<svg
							className="h-6 w-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
							role="img"
							aria-label={t("title")}
						>
							<title>{t("title")}</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
							/>
						</svg>
					</div>
					<div>
						<p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
							{t("title")}
						</p>
						<h3
							className={cn(
								"text-lg font-bold",
								isLowDisplay ? "text-red-700 dark:text-red-300" : "text-[var(--ofd-base-deep)]",
							)}
						>
							{isStale
								? t("lastKnown", { percent: percent ?? 0 })
								: percent !== null
									? `${percent}%`
									: "—"}
						</h3>
					</div>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badgeTone}`}
				>
					<span className={`h-2 w-2 rounded-full ${dotTone}`} />
					{badgeLabel}
				</span>
			</div>

			{hasReading ? (
				<>
					<div className="mb-3">
						<div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
							<div
								className={cn(
									"h-full rounded-full transition-all",
									barColor,
									isLowDisplay && "hopper-low-pulse",
								)}
								style={{ width: `${Math.max(percent ?? 0, 4)}%` }}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
								{t("daysRemaining")}
							</p>
							<p className="text-sm font-bold text-[var(--ofd-base-deep)]">
								{daysRemaining !== null ? t("daysValue", { count: daysRemaining }) : "—"}
							</p>
						</div>
						<div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
							<p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
								{t("lastUpdated")}
							</p>
							<p className="text-sm font-medium text-gray-700 dark:text-gray-200">{readingLabel}</p>
						</div>
					</div>
				</>
			) : (
				<p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
					{t("noReadingYet")}
				</p>
			)}
		</div>
	);
}
