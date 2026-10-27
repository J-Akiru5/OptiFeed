"use client";

import { FeedLevelDisplay } from "@/components/feed-level-display";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Clock, Droplets, PauseCircle, Wheat } from "lucide-react";
import { useTranslations } from "next-intl";

/** One feeder drawn on the pond canvas. */
export interface PondOverviewFeeder {
	id: string;
	label: string;
	isOffline: boolean;
	isPaused: boolean;
	levelPercent: number | null;
	levelUpdatedAt: Date | null;
	/** Already-formatted next feeding time, or null when the schedule is paused. */
	nextFeedLabel: string | null;
	/** Already-formatted water temperature, or null when there is no reading. */
	waterTempLabel: string | null;
}

/** Deterministic pin spots (percent of the canvas) so a feeder never jumps around. */
export const POND_PIN_POSITIONS = [
	{ left: 34, top: 44 },
	{ left: 63, top: 58 },
	{ left: 52, top: 30 },
	{ left: 22, top: 64 },
] as const;

interface PondOverviewProps {
	pondName: string;
	feeders: readonly PondOverviewFeeder[];
	className?: string;
}

/**
 * The pond, drawn as an illustration with one pin per feeder.
 *
 * Every pin states online/offline, the hopper level through the shared
 * `FeedLevelDisplay` (so an offline feeder reads "Last known 82 %" here too),
 * the next feed and the water temperature. Pins link to the hardware page where
 * the feeder is configured.
 */
export function PondOverview({ pondName, feeders, className }: PondOverviewProps) {
	const t = useTranslations("dashboard.home.controlRoom");
	const tHome = useTranslations("dashboard.home");

	return (
		<figure
			className={cn(
				"relative h-full min-h-[220px] overflow-hidden rounded-3xl border border-[#0A3D62]/10 bg-[#EAF3EA] shadow-sm dark:border-gray-700/60 dark:bg-[#0b1a24] xl:min-h-0",
				className,
			)}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 h-full w-full"
				viewBox="0 0 800 400"
				preserveAspectRatio="xMidYMid slice"
			>
				{/* Decorative: the figcaption and the pin list carry the information.
				    Flat fills keep both themes readable; a gradient would need
				    per-theme defs for a purely decorative drawing. */}
				<path
					d="M104 206C78 128 196 70 340 72c150 2 320 40 356 122 38 86-96 158-268 158S124 330 104 206Z"
					className="fill-[#DFEEDC] dark:fill-[#1a2c22]"
				/>
				<path
					d="M126 205c-22-64 86-113 216-111 136 2 290 34 322 102 34 72-86 132-242 132S146 311 126 205Z"
					className="fill-[#A9D8E8] dark:fill-[#0f3c53]"
				/>
				<path
					d="M152 204c-18-50 74-89 190-87 120 2 254 27 282 80 30 56-76 104-212 104S168 290 152 204Z"
					className="fill-[#C4E6F0] dark:fill-[#0b2f42]"
				/>
				{/* Ripples. Static, so nothing moves for a reader who asked for less motion. */}
				<g
					fill="none"
					strokeWidth="2"
					className="stroke-white/60 dark:stroke-[#5b9bd5]/30"
					strokeLinecap="round"
				>
					<path d="M214 216c44-14 96-16 140-6" />
					<path d="M446 268c50-12 108-10 154 6" />
					<path d="M318 320c56-10 118-8 168 6" />
					<path d="M540 150c34-6 74-2 102 8" />
				</g>
				{/* Reeds on the bank. */}
				<g className="stroke-[#6f9b63] dark:stroke-[#3c6b4a]" strokeWidth="3" strokeLinecap="round">
					<path d="M96 268l-12-30" />
					<path d="M110 274l-4-34" />
					<path d="M124 278l8-30" />
					<path d="M690 246l14-32" />
					<path d="M704 252l4-30" />
				</g>
				{/* A little dock, so the illustration reads as a working pond. */}
				<path d="M636 320h96v14h-96z" className="fill-[#B08B5A] dark:fill-[#6c5334]" />
				<path
					d="M648 334v26M716 334v26"
					className="stroke-[#8f6c42] dark:stroke-[#4c3a25]"
					strokeWidth="5"
				/>
			</svg>

			<div className="absolute left-4 top-3 flex max-w-[calc(100%-2rem)] items-center gap-2">
				<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#0A3D62] shadow-sm dark:bg-gray-900/80 dark:text-[#8fc0ea]">
					<Wheat aria-hidden="true" className="h-4 w-4" />
				</span>
				<div className="min-w-0">
					<p className="truncate text-sm font-black text-[#0A3D62] dark:text-gray-100">
						{pondName}
					</p>
					<p className="text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{feeders.length > 0 ? t("feederCount", { count: feeders.length }) : t("noFeeders")}
					</p>
				</div>
			</div>

			{feeders.length === 0 ? (
				<p className="absolute inset-x-6 bottom-4 rounded-xl bg-white/85 px-3 py-2 text-xs font-bold text-[#3D5568] dark:bg-gray-900/85 dark:text-gray-300">
					{t("noFeeders")}
				</p>
			) : (
				<ul aria-label={t("feedersLabel")} className="absolute inset-0">
					{feeders.map((feeder, index) => {
						const spot =
							POND_PIN_POSITIONS[index % POND_PIN_POSITIONS.length] ?? POND_PIN_POSITIONS[0];
						return (
							<li
								key={feeder.id}
								className="absolute -translate-x-1/2 -translate-y-1/2"
								style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
							>
								<Link
									href="/dashboard/settings/hardware"
									className="flex w-[10.5rem] flex-col gap-1 rounded-2xl border border-white/70 bg-white/95 p-2 shadow-md backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-600/70 dark:bg-gray-900/95 dark:focus-visible:outline-[#8fc0ea]"
								>
									<span className="flex min-w-0 items-center gap-1.5">
										<span
											aria-hidden="true"
											className={cn(
												"h-2 w-2 shrink-0 rounded-full",
												feeder.isOffline ? "bg-[#C42B3A]" : "bg-[#1E7B34]",
											)}
										/>
										<span className="truncate text-[11px] font-black text-[#0A3D62] dark:text-gray-100">
											{feeder.label}
										</span>
									</span>

									<FeedLevelDisplay
										levelPercent={feeder.levelPercent}
										updatedAt={feeder.levelUpdatedAt}
										isOffline={feeder.isOffline}
										showBar={false}
										size="sm"
									/>

									<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-[#3D5568] dark:text-gray-300">
										<span className="inline-flex items-center gap-1">
											{feeder.isPaused ? (
												<>
													<PauseCircle aria-hidden="true" className="h-3 w-3 text-[#C42B3A]" />
													{tHome("schedulePaused")}
												</>
											) : (
												<>
													<Clock aria-hidden="true" className="h-3 w-3" />
													{feeder.nextFeedLabel ?? "—"}
												</>
											)}
										</span>
										{feeder.waterTempLabel && (
											<span className="inline-flex items-center gap-1">
												<Droplets
													aria-hidden="true"
													className="h-3 w-3 text-[#0A3D62] dark:text-[#8fc0ea]"
												/>
												{feeder.waterTempLabel}
											</span>
										)}
									</span>
									<span className="sr-only">{t("openFeederSettings")}</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}

			<figcaption className="sr-only">
				{t("canvasLabel", { pond: pondName, count: feeders.length })}
			</figcaption>
		</figure>
	);
}
