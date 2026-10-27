"use client";

import { FeederIllustration } from "@/components/feeder/feeder-illustration";
import { Link } from "@/i18n/routing";
import { formatDateTimeLocal } from "@/lib/date-local";
import { formatFeedAmountLabel } from "@/lib/feed-figures";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
import {
	FEEDER_HERO_PHOTO_PATH,
	FEEDER_HERO_PHOTO_SESSION_KEY,
	type FeederHeroData,
} from "@/lib/feeder-hero-types";
import { cn } from "@/lib/utils";
import {
	ArrowRight,
	Brain,
	Clock,
	Cpu,
	Droplets,
	Radio,
	Timer,
	Wheat,
	WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * The feeder, shown like a premium device screen (task I-29, decision E29).
 *
 * A dark hero surface with the feeder in the middle, live readings on glassy
 * callouts with thin leader lines to the parts they describe, a status pill and
 * the advisor's one-line summary below. The hero stays dark in both themes.
 *
 * Presentation only: `loadFeederHero` does the reading, this renders it. The
 * hopper reading goes through the same `resolveFeedLevelDisplay` rule as every
 * other screen (E4), so an offline feeder says "Last known 82%" here too.
 *
 * Desktop: callouts sit around the image with leader lines. Below `md` the
 * image comes first and the callouts fall into a 2×3 grid with no lines.
 */

/** Whether the photo is known to be missing in this browser session. */
function readPhotoMissing(): boolean {
	try {
		return window.sessionStorage.getItem(FEEDER_HERO_PHOTO_SESSION_KEY) === "1";
	} catch {
		return false;
	}
}

function rememberPhotoMissing(): void {
	try {
		window.sessionStorage.setItem(FEEDER_HERO_PHOTO_SESSION_KEY, "1");
	} catch {
		// Private mode or blocked storage: the next page view probes once more.
	}
}

/**
 * Jeff's photo, laid over the illustration.
 *
 * The drawing is always underneath, so a missing file costs one failed request
 * per session (remembered in sessionStorage) and never an empty frame.
 */
function FeederPhoto({ alt }: { alt: string }) {
	const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

	useEffect(() => {
		if (readPhotoMissing()) setStatus("missing");
	}, []);

	if (status === "missing") return null;

	return (
		<Image
			src={FEEDER_HERO_PHOTO_PATH}
			alt={alt}
			fill
			priority={false}
			sizes="(min-width: 768px) 40vw, 90vw"
			data-testid="feeder-hero-photo"
			className={cn(
				"object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)] transition-opacity duration-700 motion-reduce:transition-none",
				status === "ready" ? "opacity-100" : "opacity-0",
			)}
			onLoad={() => setStatus("ready")}
			onError={() => {
				rememberPhotoMissing();
				setStatus("missing");
			}}
		/>
	);
}

interface CalloutProps {
	icon: LucideIcon;
	label: string;
	value: string;
	detail?: string;
	/** Dim a value that is stale or absent (E4). */
	muted?: boolean;
	tag?: string;
	position: string;
	index: number;
}

function Callout({
	icon: Icon,
	label,
	value,
	detail,
	muted = false,
	tag,
	position,
	index,
}: CalloutProps) {
	return (
		<li
			className={cn(
				"feeder-hero-callout relative rounded-2xl border border-white/12 bg-[#0d2433]/80 px-3 py-2 shadow-lg backdrop-blur-md",
				"md:absolute md:w-[25%] md:max-w-[13rem]",
				position,
			)}
			style={{ animationDelay: `${index * 70}ms` }}
		>
			<div className="flex items-start gap-2">
				<span
					aria-hidden="true"
					className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#8fc0ea]"
				>
					<Icon className="h-3.5 w-3.5" />
				</span>
				<div className="min-w-0">
					<p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/70">{label}</p>
					<p
						className={cn(
							"mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-black tabular-nums",
							muted ? "text-white/60" : "text-white",
						)}
					>
						{value}
						{tag && (
							<span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white/75">
								{tag}
							</span>
						)}
					</p>
					{detail && (
						<p className="mt-0.5 line-clamp-2 text-[9px] leading-tight text-white/60">{detail}</p>
					)}
				</div>
			</div>
		</li>
	);
}

/**
 * Callout placement on the desktop canvas, in percent of the hero body. The
 * order is the DOM order, which is also the 2×3 mobile grid: hopper and next
 * feed, then today's feed and water, then connection and firmware.
 */
const CALLOUT_POSITIONS = [
	"md:left-0 md:top-[8%]",
	"md:right-0 md:top-[8%]",
	"md:left-0 md:top-[41%]",
	"md:right-0 md:top-[41%]",
	"md:left-0 md:top-[74%]",
	"md:right-0 md:top-[74%]",
] as const;

/** Leader lines from each callout edge to the part it describes. */
const LEADER_LINES = [
	{ x1: 24, y1: 18, x2: 40, y2: 31 },
	{ x1: 76, y1: 18, x2: 60, y2: 31 },
	{ x1: 24, y1: 51, x2: 52, y2: 64 },
	{ x1: 76, y1: 51, x2: 53, y2: 78 },
	{ x1: 24, y1: 84, x2: 45, y2: 52 },
	{ x1: 76, y1: 84, x2: 57, y2: 55 },
] as const;

export interface FeederHeroProps extends FeederHeroData {
	pondName: string;
	className?: string;
}

export function FeederHero({ pondName, className, ...data }: FeederHeroProps) {
	const t = useTranslations("dashboard.feederHero");
	const tFeedLevel = useTranslations("dashboard.feedLevel");
	const tPrediction = useTranslations("dashboard.growth.prediction");
	const tDates = useTranslations("dates");
	const locale = useLocale();

	const {
		deviceLabel,
		isOffline,
		isPaused,
		lastSeenAt,
		hopperLevelPercent,
		hopperUpdatedAt,
		gramsToday,
		nextFeedAt,
		waterTempC,
		waterTempOk,
		waterTempUpdatedAt,
		firmwareVersion,
		advisor,
	} = data;

	const number = (value: number, digits = 0) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);

	const hopper = resolveFeedLevelDisplay({
		levelPercent: hopperLevelPercent,
		updatedAt: hopperUpdatedAt,
		isOffline,
	});
	const hopperReading =
		hopper.readingAt !== null ? formatDateTimeLocal(hopper.readingAt, tDates) : null;

	const lastSeenParts = lastSeenAt ? formatDateTimeLocal(lastSeenAt, tDates) : null;
	const lastSeenLabel = lastSeenParts
		? t("lastSeen", { date: lastSeenParts.date, time: lastSeenParts.time })
		: t("neverConnected");

	const waterReading =
		waterTempUpdatedAt !== null ? formatDateTimeLocal(waterTempUpdatedAt, tDates) : null;

	const callouts: CalloutProps[] = [
		{
			icon: Wheat,
			label: t("hopperLabel"),
			value:
				hopper.state === "none"
					? "—"
					: hopper.state === "stale"
						? tFeedLevel("lastKnown", { percent: hopper.percent })
						: `${hopper.percent}%`,
			detail:
				hopper.state === "stale"
					? hopperReading
						? tFeedLevel("readingTime", { date: hopperReading.date, time: hopperReading.time })
						: tFeedLevel("unknownTime")
					: hopper.state === "none"
						? tFeedLevel("noReadingYet")
						: undefined,
			muted: hopper.state !== "live",
			tag: hopper.state === "stale" ? tFeedLevel("offline") : undefined,
			position: CALLOUT_POSITIONS[0],
			index: 0,
		},
		{
			icon: Clock,
			label: t("nextFeedLabel"),
			value: isPaused
				? t("nextFeedPaused")
				: nextFeedAt
					? formatDateTimeLocal(nextFeedAt, tDates).time
					: "—",
			// The time alone would read as today even when the slot is tomorrow's,
			// so the chip names the day as well.
			detail: isPaused
				? undefined
				: nextFeedAt
					? t("nextFeedOn", { date: formatDateTimeLocal(nextFeedAt, tDates).date })
					: undefined,
			muted: isPaused || !nextFeedAt,
			position: CALLOUT_POSITIONS[1],
			index: 1,
		},
		{
			icon: Timer,
			label: t("fedTodayLabel"),
			value: formatFeedAmountLabel(gramsToday, locale),
			detail: t("sinceMidnight"),
			position: CALLOUT_POSITIONS[2],
			index: 2,
		},
		{
			icon: Droplets,
			label: t("waterLabel"),
			value:
				waterTempOk && waterTempC !== null ? t("waterValue", { temp: number(waterTempC, 1) }) : "—",
			detail:
				waterTempOk && waterTempC !== null
					? isOffline && waterReading
						? tFeedLevel("readingTime", { date: waterReading.date, time: waterReading.time })
						: undefined
					: t("waterUnavailable"),
			muted: !waterTempOk || waterTempC === null,
			position: CALLOUT_POSITIONS[3],
			index: 3,
		},
		{
			icon: isOffline ? WifiOff : Radio,
			label: t("connectionLabel"),
			value: isOffline ? t("statusOffline") : t("statusOnline"),
			detail: lastSeenLabel,
			muted: isOffline,
			position: CALLOUT_POSITIONS[4],
			index: 4,
		},
		{
			icon: Cpu,
			label: t("firmwareLabel"),
			value: firmwareVersion ? `v${firmwareVersion}` : "—",
			detail: firmwareVersion ? undefined : t("firmwareUnknown"),
			muted: !firmwareVersion,
			position: CALLOUT_POSITIONS[5],
			index: 5,
		},
	];

	const advisorValue =
		advisor && advisor.grams !== null ? t("advisorGrams", { grams: number(advisor.grams) }) : null;

	return (
		<section
			aria-label={t("label", { pond: pondName })}
			className={cn(
				"relative overflow-hidden rounded-3xl border border-white/10 bg-[#061520] p-4 text-white shadow-xl sm:p-5",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_-10%,rgba(232,90,42,0.22),transparent_58%),radial-gradient(90%_70%_at_50%_115%,rgba(91,155,213,0.22),transparent_65%)]"
			/>

			<div className="relative flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/55">
						{t("eyebrow")}
					</p>
					<h2 className="truncate text-lg font-black sm:text-xl">{pondName}</h2>
					<p className="truncate text-[11px] font-semibold text-white/60">{deviceLabel}</p>
				</div>
				<div className="flex flex-col items-end gap-1">
					<span
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset",
							isOffline
								? "bg-[#C42B3A]/20 text-[#ffc0c7] ring-[#C42B3A]/45"
								: "bg-[#1E7B34]/25 text-[#b7f7cd] ring-[#1E7B34]/45",
						)}
					>
						<span
							aria-hidden="true"
							className={cn(
								"h-1.5 w-1.5 rounded-full",
								isOffline ? "bg-[#ff8a95]" : "bg-[#4ade80]",
							)}
						/>
						{isOffline ? t("statusOffline") : t("statusOnline")}
					</span>
					<p className="max-w-[14rem] text-right text-[10px] font-semibold text-white/60">
						{lastSeenLabel}
					</p>
				</div>
			</div>

			<div className="relative mt-3 sm:mt-4">
				<div className="relative mx-auto aspect-[4/3] w-full max-w-[22rem] md:aspect-[16/9] md:max-w-none md:px-[27%]">
					<div className="relative h-full w-full">
						<FeederIllustration className="absolute inset-0 h-full w-full" />
						<FeederPhoto alt={t("photoAlt")} />
					</div>
				</div>

				<svg
					data-testid="feeder-hero-leaders"
					aria-hidden="true"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
				>
					{LEADER_LINES.map((line) => (
						<g key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}>
							<line
								x1={line.x1}
								y1={line.y1}
								x2={line.x2}
								y2={line.y2}
								stroke="rgba(255,255,255,0.35)"
								strokeWidth="1"
								vectorEffect="non-scaling-stroke"
							/>
							<circle cx={line.x2} cy={line.y2} r="0.7" fill="rgba(232,90,42,0.9)" />
						</g>
					))}
				</svg>

				<ul
					aria-label={t("calloutsLabel")}
					className="mt-3 grid grid-cols-2 gap-2 md:mt-0 md:block"
				>
					{callouts.map((callout) => (
						<Callout key={callout.label} {...callout} />
					))}
				</ul>
			</div>

			<div className="relative mt-3 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-2.5">
					<span
						aria-hidden="true"
						className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#E85A2A]/20 text-[#ffb08c]"
					>
						<Brain className="h-4 w-4" />
					</span>
					<div className="min-w-0">
						<p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/55">
							{t("advisorTitle")}
						</p>
						<p className="text-sm font-bold text-white">
							{advisorValue ?? t("advisorEmpty")}
							{advisorValue && advisor && (
								<span className="font-semibold text-white/65">
									{" · "}
									{t("advisorConfidence", {
										level: tPrediction(`confidence_${advisor.confidence}`),
									})}
								</span>
							)}
						</p>
						{advisorValue && advisor?.reasoning && (
							<p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-white/60">
								{advisor.reasoning}
							</p>
						)}
					</div>
				</div>
				<Link
					href="/dashboard/growth"
					className="inline-flex min-h-9 shrink-0 items-center gap-1 self-start rounded-xl border border-white/15 px-3 text-[11px] font-black text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:self-auto"
				>
					{t("advisorLink")}
					<ArrowRight aria-hidden="true" className="h-3 w-3" />
				</Link>
			</div>
		</section>
	);
}
