"use client";

import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LANDING_SECTIONS, LandingHeader } from "@/components/landing/LandingHeader";
import { LandingLogo } from "@/components/landing/LandingLogo";
import { OfflineCards } from "@/components/landing/OfflineCards";
import { CountUp, Reveal, RevealItem, RevealList } from "@/components/landing/Reveal";
import { Wave } from "@/components/landing/Wave";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	ArrowRight,
	BadgeCheck,
	Check,
	CircleDollarSign,
	Clock3,
	Cpu,
	FlaskConical,
	Gauge,
	GraduationCap,
	Landmark,
	Minus,
	Plus,
	Repeat2,
	ShieldCheck,
	SlidersHorizontal,
	Timer,
	Waves,
	WifiOff,
	X,
} from "lucide-react";
import { MotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Image from "next/image";

const TEAM = [
	"Jeff Edrick C. Martinez",
	"Karl F. Calimotan",
	"Jay R. C. Castillo",
	"Aime G. Detore",
];

const PROBLEM_ICONS = [Timer, CircleDollarSign, Repeat2] as const;
const OFFLINE_ICONS = [Clock3, WifiOff, Gauge, SlidersHorizontal] as const;
const CREDIBILITY = [
	{ key: "credibility1", icon: Landmark },
	{ key: "credibility2", icon: GraduationCap },
	{ key: "credibility3", icon: FlaskConical },
	{ key: "credibility4", icon: BadgeCheck },
	{ key: "credibility5", icon: Cpu },
] as const;
const METRICS = [
	{ value: "metric1Value", label: "metric1Label" },
	{ value: "metric2Value", label: "metric2Label" },
	{ value: "metric3Value", label: "metric3Label" },
	{ value: "metric4Value", label: "metric4Label" },
] as const;
const COMPARE_ROWS = [
	{ key: "compare1", timer: "no", us: "yes" },
	{ key: "compare2", timer: "yes", us: "yes" },
	{ key: "compare3", timer: "no", us: "yes" },
	{ key: "compare4", timer: "no", us: "yes" },
	{ key: "compare5", timer: "no", us: "partial" },
] as const;

type StatusValue = "yes" | "no" | "partial";

const container = "mx-auto w-full max-w-[80rem] px-5 sm:px-8 lg:px-10";
const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#060C11]";
const focusRingOnDark =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A5C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#061B2B]";
const eyebrow =
	"text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C4461D] dark:text-[#FF8A5C]";
const sectionTitle =
	"mt-3 text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-[#0A2E47] sm:text-[2.55rem] dark:text-white";
const sectionBody = "mt-4 text-[15px] leading-7 text-slate-600 dark:text-slate-400";
const card =
	"rounded-2xl border border-[#E3EAE7] bg-white shadow-[0_1px_2px_rgba(10,46,71,0.03)] dark:border-white/10 dark:bg-[#0C1319]";
const primaryButton =
	"inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#E85A2A] px-5 text-[14px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(232,90,42,0.7)] transition-colors hover:bg-[#D24E22]";
const secondaryOnDark =
	"inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/[0.04] px-5 text-[14px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10";

function ComparisonStatus({ value }: { value: StatusValue }) {
	const t = useTranslations("landing");
	const label =
		value === "yes" ? t("compareYes") : value === "no" ? t("compareNo") : t("comparePartial");

	if (value === "yes") {
		return (
			<span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#067647] dark:text-[#4ADE80]">
				<span className="flex size-5 items-center justify-center rounded-full bg-[#ECFDF3] dark:bg-[#4ADE80]/15">
					<Check className="size-3" aria-hidden="true" />
				</span>
				{label}
			</span>
		);
	}

	if (value === "partial") {
		return (
			<span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#B54708] dark:text-[#F0A202]">
				<span className="flex size-5 items-center justify-center rounded-full bg-[#FFFAEB] dark:bg-[#F0A202]/15">
					<Minus className="size-3" aria-hidden="true" />
				</span>
				{label}
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-400 dark:text-slate-500">
			<span className="flex size-5 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5">
				<X className="size-3" aria-hidden="true" />
			</span>
			{label}
		</span>
	);
}

export default function LandingPage() {
	const t = useTranslations("landing");
	const tBtn = useTranslations("button");

	return (
		<MotionConfig reducedMotion="user">
			<div
				id="top"
				className="min-h-screen bg-[#F7F9F8] font-sans text-[#0A2E47] selection:bg-[#E85A2A]/20 selection:text-[#0A2E47] dark:bg-[#060C11] dark:text-white"
			>
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-[#0A3D62] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
				>
					{t("skipToContent")}
				</a>

				<LandingHeader />

				<main id="main">
					{/* Hero */}
					<section className="relative z-10 overflow-x-clip overflow-y-visible bg-[#061B2B] text-white">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_60%_at_78%_10%,rgba(232,90,42,0.18),transparent_62%)]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent_85%)]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -top-40 -right-40 size-[36rem] rounded-full border border-white/[0.06]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -top-24 -right-24 size-[24rem] rounded-full border border-white/[0.06]"
						/>

						<div
							className={cn(
								container,
								"relative grid items-center gap-12 pt-14 pb-14 sm:pt-16 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-10 lg:pt-20 lg:pb-20",
							)}
						>
							<Reveal className="min-w-0">
								<p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/70 uppercase">
									<span className="size-1.5 rounded-full bg-[#FF8A5C]" />
									{t("heroTag")}
								</p>
								<h1 className="mt-6 max-w-[42rem] text-[2.4rem] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[3.2rem] xl:text-[3.65rem]">
									{t.rich("heroTitle1", {
										highlight: (chunks) => (
											<span className="relative inline-block text-[#FF8A5C]">
												{chunks}
												<svg
													aria-hidden="true"
													viewBox="0 0 120 12"
													preserveAspectRatio="none"
													className="absolute -bottom-1 left-0 h-2.5 w-full text-[#FF8A5C]"
												>
													<path
														d="M2 8.5C20 3.5 40 2.5 60 5.5C80 8.5 100 8.5 118 4"
														fill="none"
														stroke="currentColor"
														strokeWidth="3.5"
														strokeLinecap="round"
													/>
												</svg>
											</span>
										),
									})}
									<span className="mt-1 block text-white/85">{t("heroTitle2")}</span>
								</h1>
								<p className="mt-6 max-w-[34rem] text-[15.5px] leading-7 text-white/60">
									{t("heroDesc")}
								</p>

								<div className="mt-8 flex flex-col gap-3 sm:flex-row">
									<Link href="/login" className={cn(primaryButton, focusRingOnDark)}>
										{t("heroCtaPrimary")}
										<ArrowRight className="size-4" aria-hidden="true" />
									</Link>
									<a href="#how" className={cn(secondaryOnDark, focusRingOnDark)}>
										{t("heroCtaSecondary")}
									</a>
								</div>

								<ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[12px] text-white/55">
									{[1, 2, 3].map((n) => (
										<li key={n} className="flex items-center gap-1.5">
											<Check className="size-3.5 text-[#7CE3A8]" aria-hidden="true" />
											{t(`heroTrust${n}`)}
										</li>
									))}
								</ul>
							</Reveal>

							<Reveal delay={0.08} className="min-w-0">
								<DashboardPreview />
							</Reveal>
						</div>

						{/* Credibility strip — plain text */}
						<div className="relative border-t border-white/10">
							<div
								className={cn(
									container,
									"flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between",
								)}
							>
								<p className="text-[10px] font-semibold tracking-[0.18em] text-white/35 uppercase">
									{t("credibilityLabel")}
								</p>
								<ul className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
									{CREDIBILITY.map(({ key, icon: Icon }) => (
										<li
											key={key}
											className="flex items-center gap-2 text-[12px] font-medium text-white/55"
										>
											<Icon className="size-3.5 text-white/35" aria-hidden="true" />
											{t(key)}
										</li>
									))}
								</ul>
							</div>
						</div>

						{/* Wave transition to Problem section */}
						<Wave
							flip
							layered
							variant="b"
							className="bottom-0 translate-y-full text-[#061B2B] z-10"
						/>
					</section>

					{/* Problem */}
					<section
						id="problem"
						className="scroll-mt-24 border-b border-[#E3EAE7] bg-[#F7F9F8] py-20 sm:py-24 dark:border-white/10 dark:bg-[#070D13]"
					>
						<div
							className={cn(
								container,
								"grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16",
							)}
						>
							<Reveal className="lg:sticky lg:top-28 lg:self-start">
								<p className={eyebrow}>{t("problemEyebrow")}</p>
								<h2 className={sectionTitle}>{t("problemTitle")}</h2>
								<div className={cn(card, "mt-8 max-w-sm p-6")}>
									<CountUp
										text={t("problemStat")}
										className="block text-[3.5rem] leading-none font-semibold tracking-[-0.04em] text-[#E85A2A] tabular-nums sm:text-[4rem]"
									/>
									<p className="mt-3 text-[12.5px] leading-5 text-slate-500 dark:text-slate-400">
										{t("problemStatLabel")}
									</p>
								</div>
							</Reveal>

							<RevealList as="div" className="space-y-4">
								{[1, 2, 3].map((n) => {
									const Icon = PROBLEM_ICONS[n - 1];
									return (
										<RevealItem
											key={n}
											className={cn(
												card,
												"p-6 transition-shadow duration-300 hover:shadow-[0_18px_40px_-28px_rgba(10,46,71,0.45)] sm:p-7",
											)}
										>
											<div className="flex items-start gap-4">
												<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF1EA] text-[#C4461D] dark:bg-[#E85A2A]/10 dark:text-[#FF8A5C]">
													<Icon className="size-5" aria-hidden="true" />
												</span>
												<div className="min-w-0">
													<div className="flex items-baseline gap-2">
														<span className="font-mono text-[10.5px] font-medium tracking-wider text-slate-400">
															0{n}
														</span>
														<h3 className="text-[15px] font-semibold text-[#0A2E47] dark:text-white">
															{t(`problem${n}Title`)}
														</h3>
													</div>
													<p className="mt-1.5 text-[13px] leading-6 text-slate-600 dark:text-slate-400">
														{t(`problem${n}Body`)}
													</p>
												</div>
											</div>
										</RevealItem>
									);
								})}
							</RevealList>
						</div>
					</section>

					{/* Comparison */}
					<section
						id="compare"
						className="scroll-mt-24 border-b border-[#E3EAE7] bg-white py-20 sm:py-24 dark:border-white/10 dark:bg-[#0A1016]"
					>
						<div className={container}>
							<Reveal className="mx-auto max-w-2xl text-center">
								<p className={eyebrow}>{t("compareEyebrow")}</p>
								<h2 className={cn(sectionTitle, "mx-auto")}>{t("compareTitle")}</h2>
								<p className={cn(sectionBody, "mx-auto max-w-xl")}>{t("compareDesc")}</p>
							</Reveal>

							<Reveal delay={0.06} className="mt-12">
								<div
									className={cn(
										card,
										"overflow-hidden shadow-[0_24px_60px_-42px_rgba(10,46,71,0.45)]",
									)}
								>
									<table className="hidden w-full table-fixed text-left sm:table">
										<caption className="sr-only">{t("compareTitle")}</caption>
										<thead>
											<tr className="border-b border-[#E9EFEC] dark:border-white/10">
												<th
													scope="col"
													className="w-[52%] px-6 py-4 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase"
												>
													{t("compareFeature")}
												</th>
												<th
													scope="col"
													className="w-[24%] px-4 py-4 text-[11px] font-semibold text-slate-500"
												>
													{t("compareTimer")}
												</th>
												<th
													scope="col"
													className="w-[24%] border-l border-[#F4E3D9] bg-[#FFF8F3] px-4 py-4 text-[11px] font-semibold text-[#C4461D] dark:border-[#E85A2A]/20 dark:bg-[#E85A2A]/[0.07] dark:text-[#FF8A5C]"
												>
													<span className="flex items-center gap-1.5">
														<span className="size-1.5 rounded-full bg-[#E85A2A]" />
														{t("compareUs")}
													</span>
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[#E9EFEC] dark:divide-white/10">
											{COMPARE_ROWS.map(({ key, timer, us }) => (
												<tr
													key={key}
													className="transition-colors hover:bg-[#FBFDFC] dark:hover:bg-white/[0.02]"
												>
													<th
														scope="row"
														className="px-6 py-4 text-[13px] font-medium text-[#0A2E47] dark:text-slate-200"
													>
														{t(key)}
													</th>
													<td className="px-4 py-4">
														<ComparisonStatus value={timer} />
													</td>
													<td className="border-l border-[#F4E3D9] bg-[#FFF8F3]/60 px-4 py-4 dark:border-[#E85A2A]/20 dark:bg-[#E85A2A]/[0.04]">
														<ComparisonStatus value={us} />
													</td>
												</tr>
											))}
										</tbody>
									</table>

									<div className="divide-y divide-[#E9EFEC] sm:hidden dark:divide-white/10">
										{COMPARE_ROWS.map(({ key, timer, us }) => (
											<div key={key} className="p-4">
												<p className="text-[13px] font-semibold text-[#0A2E47] dark:text-white">
													{t(key)}
												</p>
												<dl className="mt-3 grid grid-cols-2 gap-3">
													<div>
														<dt className="text-[9px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
															{t("compareTimer")}
														</dt>
														<dd className="mt-1.5">
															<ComparisonStatus value={timer} />
														</dd>
													</div>
													<div className="rounded-lg bg-[#FFF8F3] px-2.5 py-2 dark:bg-[#E85A2A]/[0.07]">
														<dt className="text-[9px] font-semibold tracking-[0.12em] text-[#C4461D] uppercase dark:text-[#FF8A5C]">
															{t("compareUs")}
														</dt>
														<dd className="mt-1.5">
															<ComparisonStatus value={us} />
														</dd>
													</div>
												</dl>
											</div>
										))}
									</div>
								</div>

								<p className="mx-auto mt-5 max-w-2xl text-center text-[12px] leading-5 text-slate-500 dark:text-slate-400">
									{t("compareFootnote")}
								</p>
							</Reveal>
						</div>
					</section>

					<HowItWorks />

					{/* Offline-first */}
					<section
						id="offline"
						className="relative scroll-mt-24 overflow-x-clip bg-[#0A2E47] text-white"
					>
						<Wave layered className="top-0 -translate-y-full text-[#0A2E47]" />
						<Wave flip layered variant="b" className="bottom-0 translate-y-full text-[#0A2E47]" />
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_80%_80%_at_70%_20%,black,transparent)]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -right-40 -bottom-40 size-[34rem] rounded-full border border-white/[0.07]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -right-24 -bottom-24 size-[22rem] rounded-full border border-white/[0.07]"
						/>

						<div
							className={cn(
								container,
								"relative grid gap-12 py-20 sm:py-24 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16",
							)}
						>
							<Reveal>
								<p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-[#FF8A5C] uppercase">
									<span className="size-1.5 rounded-full bg-[#FF8A5C]" />
									{t("navOffline")}
								</p>
								<h2 className="mt-4 max-w-[32rem] text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[2.55rem]">
									{t("offlineTitle")}
								</h2>
								<p className="mt-4 max-w-[30rem] text-[15px] leading-7 text-white/60">
									{t("offlineDesc")}
								</p>

								<div className="mt-8 border-t border-white/10 pt-5">
									<p className="text-[10px] font-semibold tracking-[0.14em] text-white/45 uppercase">
										{t("viewsTitle")}
									</p>
									<ul className="mt-3 space-y-2.5">
										{[1, 2, 3].map((n) => (
											<li key={n} className="flex gap-2.5 text-[12.5px] leading-5 text-white/60">
												<Check
													className="mt-0.5 size-3.5 shrink-0 text-[#FF8A5C]"
													aria-hidden="true"
												/>
												{t(`views${n}`)}
											</li>
										))}
									</ul>
								</div>
							</Reveal>

							<Reveal delay={0.06}>
								<OfflineCards
									cards={OFFLINE_ICONS.map((icon, index) => {
										const n = index + 1;
										return {
											id: n,
											icon,
											title: t(`offline${n}Title`),
											body: t(`offline${n}Body`),
										};
									})}
								/>
							</Reveal>
						</div>

						<div className={cn(container, "relative pb-14 sm:pb-16")}>
							<ol className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
								{[1, 2, 3, 4].map((n) => (
									<li key={n} className="bg-[#0A2E47] p-4">
										<p className="font-mono text-[10px] text-[#FF8A5C]">0{n}</p>
										<p className="mt-1.5 text-[12px] leading-5 text-white/60">
											{t(`offlineFlow${n}`)}
										</p>
									</li>
								))}
							</ol>
						</div>
					</section>

					{/* Hardware */}
					<section
						id="hardware"
						className="scroll-mt-24 border-b border-[#E3EAE7] bg-white py-20 sm:py-24 dark:border-white/10 dark:bg-[#0A1016]"
					>
						<div
							className={cn(
								container,
								"grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16",
							)}
						>
							<Reveal className="lg:sticky lg:top-28 lg:self-start">
								<p className={eyebrow}>{t("hardwareEyebrow")}</p>
								<h2 className={sectionTitle}>{t("hardwareTitle")}</h2>
								<p className={cn(sectionBody, "max-w-md")}>{t("hardwareDesc")}</p>
								<ul className="mt-6 space-y-2.5 text-[12.5px] text-slate-600 dark:text-slate-400">
									<li className="flex items-center gap-2">
										<Cpu
											className="size-3.5 text-[#C4461D] dark:text-[#FF8A5C]"
											aria-hidden="true"
										/>
										ESP32 DevKit V1
									</li>
									<li className="flex items-center gap-2">
										<Clock3
											className="size-3.5 text-[#C4461D] dark:text-[#FF8A5C]"
											aria-hidden="true"
										/>
										DS3231 real-time clock
									</li>
									<li className="flex items-center gap-2">
										<Gauge
											className="size-3.5 text-[#C4461D] dark:text-[#FF8A5C]"
											aria-hidden="true"
										/>
										HC-SR04 hopper sensor
									</li>
								</ul>
							</Reveal>

							<Reveal delay={0.06} className="min-w-0">
								<div className={cn(card, "overflow-hidden")}>
									<table className="w-full table-fixed text-left text-[12.5px]">
										<caption className="sr-only">{t("hardwareTitle")}</caption>
										<thead className="border-b border-[#E9EFEC] text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase dark:border-white/10 dark:text-slate-400">
											<tr>
												<th scope="col" className="w-[42%] px-4 py-3.5 font-semibold sm:px-5">
													{t("hwColPart")}
												</th>
												<th scope="col" className="px-4 py-3.5 font-semibold sm:px-5">
													{t("hwColRole")}
												</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-[#E9EFEC] dark:divide-white/10">
											{[1, 2, 3, 4, 5, 6].map((n) => (
												<tr
													key={n}
													className="transition-colors hover:bg-[#FBFDFC] dark:hover:bg-white/[0.02]"
												>
													<th
														scope="row"
														className="px-4 py-3.5 text-left font-semibold text-[#0A2E47] sm:px-5 dark:text-white"
													>
														{t(`hw${n}Part`)}
													</th>
													<td className="px-4 py-3.5 text-slate-600 sm:px-5 dark:text-slate-400">
														{t(`hw${n}Role`)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</Reveal>
						</div>
					</section>

					{/* Research */}
					<section
						id="research"
						className="scroll-mt-24 border-b border-[#E3EAE7] bg-[#F7F9F8] py-20 sm:py-24 dark:border-white/10 dark:bg-[#070D13]"
					>
						<div className={container}>
							<Reveal className="max-w-2xl">
								<p className={eyebrow}>{t("studyEyebrow")}</p>
								<h2 className={sectionTitle}>{t("studyTitle")}</h2>
								<p className={cn(sectionBody, "max-w-xl")}>{t("studyDesc")}</p>
							</Reveal>

							<div className="mt-12 grid gap-5 lg:grid-cols-2">
								<Reveal className={cn(card, "p-6 sm:p-7")}>
									<div className="flex items-center gap-2.5">
										<FlaskConical
											className="size-4 text-[#C4461D] dark:text-[#FF8A5C]"
											aria-hidden="true"
										/>
										<h3 className="text-[14px] font-semibold text-[#0A2E47] dark:text-white">
											{t("researchStudyTitle")}
										</h3>
									</div>
									<dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6">
										{METRICS.map(({ value, label }) => (
											<div key={value}>
												<dt className="text-[9.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase dark:text-slate-400">
													{t(label)}
												</dt>
												<dd className="mt-1 text-[1.55rem] leading-none font-semibold tracking-[-0.03em] text-[#0A2E47] tabular-nums dark:text-white">
													{t(value)}
												</dd>
											</div>
										))}
									</dl>
									<p className="mt-6 flex items-start gap-2 rounded-lg bg-[#F7F9F8] p-3 text-[11.5px] leading-5 text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
										<Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
										{t("studyResults")}
									</p>
								</Reveal>

								<Reveal delay={0.06} className={cn(card, "p-6 sm:p-7")}>
									<div className="flex items-center gap-2.5">
										<ShieldCheck
											className="size-4 text-[#C4461D] dark:text-[#FF8A5C]"
											aria-hidden="true"
										/>
										<h3 className="text-[14px] font-semibold text-[#0A2E47] dark:text-white">
											{t("researchQualityTitle")}
										</h3>
									</div>
									<ul className="mt-5 flex flex-wrap gap-2">
										{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
											<li
												key={n}
												className="rounded-full border border-[#E3EAE7] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
											>
												{t(`iso${n}`)}
											</li>
										))}
									</ul>
									<p className="mt-5 border-t border-[#E9EFEC] pt-4 text-[11.5px] leading-5 text-slate-500 dark:border-white/10 dark:text-slate-400">
										{t("study4Value")}
									</p>
								</Reveal>
							</div>

							<Reveal delay={0.1} className={cn(card, "mt-5 p-6 sm:p-7")}>
								<h3 className="text-[14px] font-semibold text-[#0A2E47] dark:text-white">
									{t("scopeTitle")}
								</h3>
								<ul className="mt-4 grid gap-3 sm:grid-cols-2">
									{[1, 2, 3, 4].map((n) => (
										<li
											key={n}
											className="flex gap-2.5 text-[12.5px] leading-5 text-slate-600 dark:text-slate-400"
										>
											<span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#E85A2A]" />
											{t(`scope${n}`)}
										</li>
									))}
								</ul>
							</Reveal>

							<div className="mt-12 grid gap-10 border-t border-[#E3EAE7] pt-10 lg:grid-cols-2 lg:gap-16 dark:border-white/10">
								<Reveal>
									<p className={eyebrow}>{t("teamEyebrow")}</p>
									<h3 className="mt-3 text-[1.35rem] font-semibold tracking-[-0.02em] text-[#0A2E47] dark:text-white">
										{t("teamTitle")}
									</h3>
									<p className="mt-2 max-w-lg text-[12.5px] leading-6 text-slate-600 dark:text-slate-400">
										{t("teamDesc")}
									</p>
									<ul className="mt-5 grid gap-2 sm:grid-cols-2">
										{TEAM.map((name) => (
											<li
												key={name}
												className="flex items-center gap-2.5 text-[12.5px] text-[#0A2E47] dark:text-slate-300"
											>
												<span className="size-1 rounded-full bg-[#E85A2A]" />
												{name}
											</li>
										))}
									</ul>
								</Reveal>

								<Reveal delay={0.06}>
									<p className={eyebrow}>{t("paperLabel")}</p>
									<blockquote className="mt-3 rounded-xl border border-[#E3EAE7] bg-white p-5 dark:border-white/10 dark:bg-[#0C1319]">
										<p className="text-[15px] font-medium leading-6 text-[#0A2E47] dark:text-white">
											{t("paperTitle")}
										</p>
										<footer className="mt-3 text-[11.5px] leading-5 text-slate-500 dark:text-slate-400">
											{t("footerProject")}
										</footer>
									</blockquote>
								</Reveal>
							</div>
						</div>
					</section>

					{/* FAQ */}
					<section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-24 dark:bg-[#0A1016]">
						<div
							className={cn(
								container,
								"grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16",
							)}
						>
							<Reveal className="lg:sticky lg:top-28 lg:self-start">
								<p className={eyebrow}>{t("faqEyebrow")}</p>
								<h2 className={sectionTitle}>{t("faqTitle")}</h2>
								<p className={cn(sectionBody, "max-w-sm")}>{t("faqAside")}</p>
								<Link
									href="/login"
									className={cn(
										"mt-6 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-[#0A3D62] transition-colors hover:text-[#E85A2A] dark:text-white dark:hover:text-[#FF8A5C]",
										focusRing,
									)}
								>
									{tBtn("login")}
									<ArrowRight className="size-3.5" aria-hidden="true" />
								</Link>
							</Reveal>

							<Reveal delay={0.06}>
								<div className={cn(card, "px-5 sm:px-7")}>
									{[1, 2, 3, 4, 5].map((n) => (
										<details
											key={n}
											className="group border-b border-[#E9EFEC] last:border-0 dark:border-white/10"
										>
											<summary
												className={cn(
													"flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[14px] font-medium text-[#0A2E47] transition-colors hover:text-[#C4461D] dark:text-white dark:hover:text-[#FF8A5C] [&::-webkit-details-marker]:hidden",
													focusRing,
												)}
											>
												<span>{t(`faq${n}q`)}</span>
												<Plus
													className="size-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-45 dark:text-slate-500"
													aria-hidden="true"
												/>
											</summary>
											<p className="max-w-2xl pb-5 text-[13px] leading-6 text-slate-600 dark:text-slate-400">
												{t(`faq${n}a`)}
											</p>
										</details>
									))}
								</div>
							</Reveal>
						</div>
					</section>
				</main>

				{/* Closing CTA + footer */}
				<footer className="relative overflow-x-clip bg-[#061B2B] text-white">
					<Wave layered variant="b" className="top-0 -translate-y-full text-[#061B2B]" />
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_80%_80%_at_80%_20%,black,transparent)]"
					/>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute -top-32 -right-32 size-[30rem] rounded-full border border-white/[0.06]"
					/>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute -top-16 -right-16 size-[18rem] rounded-full border border-white/[0.06]"
					/>

					<div className={cn(container, "relative")}>
						<div className="grid gap-10 border-b border-white/10 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16 lg:py-20">
							<Reveal>
								<p className="text-[11px] font-semibold tracking-[0.18em] text-[#FF8A5C] uppercase">
									{t("ctaEyebrow")}
								</p>
								<h2 className="mt-4 max-w-xl text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-white sm:text-[2.6rem]">
									{t("ctaTitle")}
								</h2>
								<p className="mt-3 max-w-lg text-[14px] leading-6 text-white/60">{t("ctaDesc")}</p>
								<div className="mt-7 flex flex-col gap-3 sm:flex-row">
									<Link href="/login" className={cn(primaryButton, focusRingOnDark)}>
										{tBtn("login")}
										<ArrowRight className="size-4" aria-hidden="true" />
									</Link>
									<a href="#how" className={cn(secondaryOnDark, focusRingOnDark)}>
										{t("heroCtaSecondary")}
									</a>
								</div>
							</Reveal>

							<Reveal delay={0.06} className="min-w-0">
								<div className="relative h-56 overflow-hidden rounded-2xl border border-white/15 sm:h-64">
									<Image
										src="/landing/hero-pond.jpg"
										alt={t("heroImageAlt")}
										fill
										sizes="(max-width: 1024px) 100vw, 480px"
										className="object-cover"
									/>
									<div
										aria-hidden="true"
										className="absolute inset-0 bg-gradient-to-t from-[#061B2B] via-[#061B2B]/25 to-transparent"
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
									<div className="absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-between gap-3">
										<div>
											<p className="text-[9px] font-semibold tracking-[0.14em] text-white/55 uppercase">
												{t("previewNextFeed")}
											</p>
											<p className="mt-1 text-[1.7rem] leading-none font-semibold tracking-[-0.03em] tabular-nums">
												10:00 <span className="text-[12px] text-white/60">AM</span>
											</p>
										</div>
										<span className="flex items-center gap-1.5 rounded-full bg-[#ECFDF3]/95 px-2.5 py-1 text-[9.5px] font-semibold text-[#067647]">
											<span className="size-1.5 rounded-full bg-[#17B26A]" />
											{t("previewStatus")}
										</span>
									</div>
								</div>
							</Reveal>
						</div>

						<div className="flex flex-col gap-6 py-8">
							<div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
								<div className="flex flex-wrap items-center gap-3">
									<LandingLogo size={28} wordmarkClassName="h-[17px]" />
									<p className="text-[10.5px] text-white/50">{t("footerSubtitle")}</p>
								</div>

								<nav
									aria-label={t("footerNavLabel")}
									className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/55"
								>
									{LANDING_SECTIONS.map(({ id, key }) => (
										<a
											key={id}
											href={`#${id}`}
											className={cn(
												"rounded-md transition-colors hover:text-white",
												focusRingOnDark,
											)}
										>
											{t(key)}
										</a>
									))}
								</nav>

								<LocaleSwitcher variant="dark" />
							</div>

							<div className="flex flex-col gap-2 border-t border-white/10 pt-5 text-[10.5px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
								<p>{t("footerCopyright")}</p>
								<p className="font-mono tracking-wide">{t("footerFirmware")}</p>
							</div>
						</div>
					</div>
				</footer>
			</div>
		</MotionConfig>
	);
}
