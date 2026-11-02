import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ChevronRight, Clock } from "lucide-react";

interface NextFeedingStripProps {
	/** The active pond, so the strip names what it is feeding. */
	pondName: string;
	/** "Next scheduled feeding". */
	label: string;
	/** Already-formatted time, or an em dash when paused. */
	time: string;
	/** Screen-reader label for the time value. */
	timeSrLabel: string;
	isPaused: boolean;
	statusLabel: string;
	volumeLabel: string;
	volumeValue: string;
	rateLabel: string;
	rateValue: string;
	basedOn: string | null;
	updateLabel: string;
	/** Route of the biomass sample form. */
	updateHref: string;
	className?: string;
}

/**
 * The compact "next feeding" control strip (#186): the feeding schedule stays
 * the first thing a farmer sees, including in the one-viewport control room.
 */
export function NextFeedingStrip({
	pondName,
	label,
	time,
	timeSrLabel,
	isPaused,
	statusLabel,
	volumeLabel,
	volumeValue,
	rateLabel,
	rateValue,
	basedOn,
	updateLabel,
	updateHref,
	className,
}: NextFeedingStripProps) {
	return (
		<section
			data-onboard="next-feeding"
			data-help="next-feeding"
			className={cn(
				"ofd-hero-strip relative overflow-hidden rounded-3xl border border-[#0A3D62]/5 bg-white p-4 shadow-md dark:border-gray-700/50 dark:bg-gray-900 md:p-5",
				"max-xl:rounded-none max-xl:border-0 max-xl:bg-[#EAF1F6] max-xl:p-4 max-xl:pt-5 max-xl:shadow-none dark:max-xl:bg-[#0b1a24]",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#0A3D62]/5 dark:bg-[#5b9bd5]/10"
			/>
			<div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
				<div className="flex min-w-0 items-center gap-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#8fc0ea]">
						<Clock aria-hidden="true" className="h-5 w-5" />
					</span>
					<div className="min-w-0">
						<p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#3D5568] dark:text-gray-400">
							{label}
						</p>
						<p className="truncate text-base font-black text-[#0A3D62] dark:text-gray-100 md:text-lg">
							{pondName}
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<p className="ofd-hero-time text-4xl font-black leading-none tracking-tighter text-[#0A3D62] dark:text-[#5b9bd5] md:text-5xl">
						<span className="sr-only">{timeSrLabel}: </span>
						{isPaused ? "—:—" : time}
					</p>
					<span
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider",
							isPaused
								? "border-red-200 bg-red-50 text-[#C42B3A] dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
								: "border-[#1E7B34]/20 bg-[#1E7B34]/10 text-[#1E7B34] dark:border-green-800 dark:bg-green-900/30 dark:text-green-400",
						)}
					>
						<span
							aria-hidden="true"
							className={cn(
								"h-1.5 w-1.5 rounded-full",
								isPaused ? "bg-[#C42B3A]" : "motion-safe:animate-pulse bg-[#1E7B34]",
							)}
						/>
						{statusLabel}
					</span>
				</div>

				<dl className="flex items-end gap-6 xl:border-l xl:border-gray-100 xl:pl-6 dark:xl:border-gray-700/60">
					<div>
						<dt className="text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{volumeLabel}
						</dt>
						<dd className="text-xl font-black text-[#C2410C] dark:text-[#ff8a5c] md:text-2xl">
							{volumeValue}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
							{rateLabel}
						</dt>
						<dd className="text-xl font-black text-[#0A3D62] dark:text-white md:text-2xl">
							{rateValue}
						</dd>
					</div>
				</dl>

				<div className="flex flex-col gap-1">
					<Link
						href={updateHref}
						className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-[#12588c] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C] dark:bg-[#1f66a0] dark:hover:bg-[#2778b8]"
					>
						{updateLabel} <ChevronRight aria-hidden="true" className="h-4 w-4" />
					</Link>
					{basedOn && (
						<p className="max-w-[16rem] text-[10px] font-medium text-[#3D5568] dark:text-gray-400">
							{basedOn}
						</p>
					)}
				</div>
			</div>
		</section>
	);
}
