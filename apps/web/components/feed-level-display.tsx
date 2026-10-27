"use client";

import { formatDateTimeLocal } from "@/lib/date-local";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface FeedLevelDisplayProps {
	levelPercent: number | null;
	updatedAt: Date | null;
	isOffline: boolean;
	/** Draw the level bar next to the value. Off by default inside stat tiles. */
	showBar?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
}

/**
 * One hopper-level surface for every screen (decision E4, #192).
 *
 * - live (online): the coloured bar and the current percentage.
 * - stale (offline): a greyed bar, "Last known 82%", the reading time and an
 *   Offline tag.
 * - none: "—" and "No reading yet".
 */
export function FeedLevelDisplay({
	levelPercent,
	updatedAt,
	isOffline,
	showBar = true,
	size = "md",
	className,
}: FeedLevelDisplayProps) {
	const t = useTranslations("dashboard.feedLevel");
	const tDates = useTranslations("dates");
	const display = resolveFeedLevelDisplay({ levelPercent, updatedAt, isOffline });

	const valueClass =
		size === "sm"
			? "text-[11px] font-bold"
			: size === "lg"
				? "text-lg font-extrabold"
				: "text-sm font-bold";
	const metaClass = "text-[10px] leading-tight text-[#3D5568] dark:text-gray-400";

	const readingTime =
		display.readingAt !== null ? formatDateTimeLocal(display.readingAt, tDates) : null;

	return (
		<div className={cn("space-y-1", className)}>
			<div className="flex flex-wrap items-center gap-2">
				{showBar && (
					<div
						aria-hidden="true"
						className={cn(
							"overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700",
							size === "sm" ? "h-1.5 w-16" : "h-2 w-24",
						)}
					>
						<div
							className={cn(
								"h-full rounded-full transition-all",
								display.state === "live"
									? display.percent < 20
										? "bg-[#E85A2A]"
										: "bg-[#1E7B34]"
									: "bg-gray-400",
							)}
							style={{ width: `${display.percent ?? 0}%` }}
						/>
					</div>
				)}
				<span
					className={cn(
						"tabular-nums",
						valueClass,
						display.state === "live"
							? "text-[#0A3D62] dark:text-gray-100"
							: "text-[#3D5568] dark:text-gray-400",
					)}
				>
					{display.state === "none"
						? "—"
						: display.state === "stale"
							? t("lastKnown", { percent: display.percent })
							: `${display.percent}%`}
				</span>
				{display.state === "stale" && (
					<span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:bg-gray-800 dark:text-gray-300">
						{t("offline")}
					</span>
				)}
			</div>
			{display.state === "stale" && (
				<p className={metaClass}>
					{readingTime
						? t("readingTime", { date: readingTime.date, time: readingTime.time })
						: t("unknownTime")}
				</p>
			)}
			{display.state === "none" && <p className={metaClass}>{t("noReadingYet")}</p>}
		</div>
	);
}
