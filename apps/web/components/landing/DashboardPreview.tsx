"use client";

import { Check, Waves, Wifi } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

/**
 * Illustrative product preview used in the hero.
 *
 * Every number here is sample data and the card says so; it must never be
 * mistaken for a live pond reading.
 */
export function DashboardPreview() {
	const t = useTranslations("landing");

	return (
		<figure className="relative mx-auto w-full max-w-[33rem] lg:mx-0">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -inset-10 rounded-[3rem] bg-[radial-gradient(circle_at_70%_18%,rgba(232,90,42,0.22),transparent_62%)] blur-2xl"
			/>

			<div className="relative overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#082238] shadow-[0_50px_120px_-42px_rgba(0,0,0,0.95)]">
				<div className="relative h-44 sm:h-48">
					<Image
						src="/landing/hero-pond.jpg"
						alt={t("heroImageAlt")}
						fill
						priority
						sizes="(max-width: 1024px) 92vw, 528px"
						className="object-cover"
					/>
					<div
						aria-hidden="true"
						className="absolute inset-0 bg-gradient-to-t from-[#082238] via-[#082238]/25 to-transparent"
					/>
					<div className="absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-2">
						<span className="flex items-center gap-1.5 rounded-full bg-[#062A44]/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
							<Waves className="size-3.5" aria-hidden="true" />
							{t("previewPond")} · {t("previewRegion")}
						</span>
						<span className="rounded-full border border-white/20 bg-[#062A44]/70 px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-white/85 uppercase backdrop-blur-sm">
							{t("previewLabel")}
						</span>
					</div>
				</div>

				<div className="relative -mt-5 rounded-t-[1.35rem] bg-[#F6FAF8] px-4 pt-5 pb-4 text-[#0A2E47] sm:px-5 sm:pb-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-[9.5px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
								{t("previewNextFeed")}
							</p>
							<div className="mt-1.5 flex items-baseline gap-1.5">
								<span className="text-[2.1rem] leading-none font-semibold tracking-[-0.045em] tabular-nums">
									10:00
								</span>
								<span className="text-[12px] font-semibold text-slate-500">AM</span>
							</div>
							<p className="mt-1.5 text-[11.5px] text-slate-500">{t("previewNextFeedMeta")}</p>
						</div>
						<span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#ECFDF3] px-2.5 py-1 text-[9.5px] font-semibold text-[#067647] ring-1 ring-[#ABEFC6]">
							<span className="size-1.5 rounded-full bg-[#17B26A]" />
							{t("previewStatus")}
						</span>
					</div>

					<div className="mt-5">
						<div className="flex items-baseline justify-between gap-4 text-[11px] font-medium">
							<span className="text-slate-500">{t("previewFeedLevel")}</span>
							<span className="tabular-nums text-[#0A2E47]">{t("previewFeedLevelValue")}</span>
						</div>
						<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
							<div className="h-full w-[68%] rounded-full bg-[#0A3D62]" />
						</div>
					</div>

					<div className="mt-4 grid grid-cols-2 gap-4 border-t border-[#E4ECE8] pt-3.5">
						<div>
							<p className="text-[9.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
								{t("previewFcr")}
							</p>
							<p className="mt-1 text-[17px] font-semibold tabular-nums">{t("previewFcrValue")}</p>
						</div>
						<div>
							<p className="text-[9.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
								{t("previewBiomass")}
							</p>
							<p className="mt-1 text-[17px] font-semibold tabular-nums">
								{t("previewBiomassValue")}
							</p>
						</div>
					</div>

					<p className="mt-4 border-t border-[#E4ECE8] pt-2.5 text-[9.5px] text-slate-400">
						{t("calcBadge")}
					</p>
				</div>
			</div>

			<div className="absolute top-24 -right-2 z-10 hidden w-[10.5rem] rounded-xl border border-[#E4ECE8] bg-white p-3 text-[#0A2E47] shadow-[0_20px_45px_-18px_rgba(0,0,0,0.55)] sm:block lg:-right-4">
				<div className="flex items-center gap-2">
					<span className="flex size-6 items-center justify-center rounded-full bg-[#ECFDF3] text-[#067647]">
						<Check className="size-3.5" aria-hidden="true" />
					</span>
					<p className="text-[9px] font-semibold tracking-[0.1em] text-slate-500 uppercase">
						{t("previewLoggedTitle")}
					</p>
				</div>
				<p className="mt-2 text-[12.5px] font-semibold">{t("previewLoggedValue")}</p>
			</div>

			<div className="absolute -bottom-8 left-6 z-10 hidden w-[11.5rem] rounded-xl border border-white/15 bg-[#0B2336]/95 p-3 text-white shadow-[0_20px_45px_-18px_rgba(0,0,0,0.8)] backdrop-blur md:block">
				<div className="flex items-center gap-2">
					<span className="flex size-6 items-center justify-center rounded-full bg-white/10 text-[#7CE3A8]">
						<Wifi className="size-3.5" aria-hidden="true" />
					</span>
					<p className="text-[9px] font-semibold tracking-[0.1em] text-white/55 uppercase">
						{t("previewQueueTitle")}
					</p>
				</div>
				<p className="mt-2 text-[11.5px] text-white/70">{t("previewQueueValue")}</p>
			</div>
		</figure>
	);
}
