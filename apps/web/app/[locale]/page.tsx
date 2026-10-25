"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { CountUp, Reveal, RevealItem, RevealList } from "@/components/landing/Reveal";
import { useTheme } from "@/components/theme-provider";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	ArrowRight,
	Check,
	Clock3,
	Cpu,
	Gauge,
	Menu,
	Moon,
	Plus,
	SlidersHorizontal,
	Sun,
	Waves,
	WifiOff,
	X,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";

const HERO_IMG =
	"https://images.unsplash.com/photo-1541441056316-443fff347c40?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1200";

const TEAM = [
	"Jeff Edrick C. Martinez",
	"Karl F. Calimotan",
	"Jay R. C. Castillo",
	"Aime G. Detore",
];

const SECTIONS = [
	{ id: "problem", key: "navProblem" },
	{ id: "how", key: "navHow" },
	{ id: "offline", key: "navOffline" },
	{ id: "hardware", key: "navHardware" },
	{ id: "study", key: "navStudy" },
	{ id: "faq", key: "navFaq" },
] as const;

const OFFLINE_ICONS = [Clock3, WifiOff, Gauge, SlidersHorizontal] as const;

const container = "mx-auto w-full max-w-[78rem] px-5 sm:px-8 lg:px-10";
const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B1117]";
const focusRingOnNavy =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A3D62]";
const eyebrow =
	"text-[11px] font-semibold uppercase tracking-[0.18em] text-[#E85A2A] dark:text-[#FF8A5C]";
const sectionTitle =
	"mt-4 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-[#0A2E47] sm:text-[2.4rem] dark:text-white";
const sectionBody = "mt-4 text-[14.5px] leading-6 text-slate-600 dark:text-slate-400";
const primaryButton =
	"inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#E85A2A] px-5 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(10,46,71,0.15)] transition-colors hover:bg-[#D24E22]";
const secondaryButton =
	"inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#D6DFDB] bg-white px-5 text-[14px] font-medium text-[#0A2E47] transition-colors hover:border-[#BCC9C4] hover:text-[#0A3D62] dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:border-white/20";

export default function LandingPage() {
	const router = useRouter();
	const pathname = usePathname();
	const locale = useLocale();
	const t = useTranslations("landing");
	const tBtn = useTranslations("button");
	const { resolvedTheme, setTheme } = useTheme();
	const [isLocalePending, startLocaleTransition] = useTransition();
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeSection, setActiveSection] = useState<string | null>(null);

	useEffect(() => {
		const elements = SECTIONS.map(({ id }) => document.getElementById(id)).filter(
			(element): element is HTMLElement => element !== null,
		);
		const visible = new Map<string, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) visible.set(entry.target.id, entry.intersectionRatio);
					else visible.delete(entry.target.id);
				}
				let best: string | null = null;
				let bestRatio = 0;
				for (const [id, ratio] of visible) {
					if (ratio > bestRatio) {
						best = id;
						bestRatio = ratio;
					}
				}
				setActiveSection(best);
			},
			{ rootMargin: "-30% 0px -50% 0px", threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
		);
		for (const element of elements) observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!menuOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [menuOpen]);

	const switchLocale = (nextLocale: "en" | "hil") => {
		if (nextLocale === locale) return;
		startLocaleTransition(() => {
			router.replace({ pathname }, { locale: nextLocale });
		});
	};

	return (
		<MotionConfig reducedMotion="user">
			<div className="landing-grid min-h-screen font-sans text-[#0A2E47] selection:bg-[#E85A2A]/20 selection:text-[#0A2E47] dark:text-white">
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-[#0A3D62] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
				>
					{t("skipToContent")}
				</a>

				<header className="sticky top-0 z-50 border-b border-[#DFE7E4] bg-[#F3F7F5]/90 backdrop-blur-md dark:border-white/10 dark:bg-[#0B1117]/90">
					<div className={cn(container, "flex h-16 items-center justify-between gap-4")}>
						<Link
							href="/"
							aria-label={t("homeLabel")}
							className={cn("flex items-center gap-2.5 rounded-md", focusRing)}
						>
							<OptiFeedLogo size={30} variant="color-light" />
							<Image
								src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
								alt="PakaonAI"
								width={120}
								height={28}
								priority
								className="h-[18px] w-auto object-contain sm:h-5 lg:h-6"
							/>
						</Link>

						<nav aria-label={t("primaryNavLabel")} className="hidden items-center gap-1 lg:flex">
							{SECTIONS.map(({ id, key }) => (
								<a
									key={id}
									href={`#${id}`}
									aria-current={activeSection === id ? "true" : undefined}
									className={cn(
										"relative rounded-md px-2.5 py-2 text-[12.5px] font-medium transition-colors",
										activeSection === id
											? "text-[#0A3D62] dark:text-white"
											: "text-slate-600 hover:text-[#0A3D62] dark:text-slate-400 dark:hover:text-white",
										focusRing,
									)}
								>
									{t(key)}
									{activeSection === id && (
										<motion.span
											layoutId="landing-nav-underline"
											className="absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full bg-[#E85A2A]"
											transition={{ type: "spring", stiffness: 500, damping: 40 }}
										/>
									)}
								</a>
							))}
						</nav>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
								aria-label={resolvedTheme === "dark" ? t("themeToLight") : t("themeToDark")}
								className={cn(
									"flex size-9 items-center justify-center rounded-lg border border-[#DCE5E1] bg-white text-slate-500 transition-colors hover:border-[#C4D1CC] hover:text-[#0A3D62] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-white",
									focusRing,
								)}
							>
								{resolvedTheme === "dark" ? (
									<Sun className="size-4" aria-hidden="true" />
								) : (
									<Moon className="size-4" aria-hidden="true" />
								)}
							</button>

							<Link
								href="/login"
								className={cn(
									"hidden h-9 items-center rounded-lg border border-[#D6DFDB] bg-white px-3.5 text-[12.5px] font-semibold text-[#0A2E47] transition-colors hover:border-[#BCC9C4] hover:text-[#0A3D62] sm:inline-flex dark:border-white/15 dark:bg-white/[0.04] dark:text-white dark:hover:border-white/25",
									focusRing,
								)}
							>
								{tBtn("login")}
							</Link>

							<button
								type="button"
								onClick={() => setMenuOpen((open) => !open)}
								aria-expanded={menuOpen}
								aria-controls="landing-mobile-menu"
								aria-label={menuOpen ? t("navClose") : t("navMenu")}
								className={cn(
									"flex size-9 items-center justify-center rounded-lg border border-[#DCE5E1] bg-white text-[#0A3D62] lg:hidden dark:border-white/10 dark:bg-white/[0.04] dark:text-white",
									focusRing,
								)}
							>
								{menuOpen ? (
									<X className="size-4" aria-hidden="true" />
								) : (
									<Menu className="size-4" aria-hidden="true" />
								)}
							</button>
						</div>
					</div>

					<AnimatePresence>
						{menuOpen && (
							<motion.nav
								id="landing-mobile-menu"
								aria-label={t("primaryNavLabel")}
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								transition={{ duration: 0.22, ease: "easeOut" }}
								className="overflow-hidden border-t border-[#DFE7E4] bg-[#F3F7F5] lg:hidden dark:border-white/10 dark:bg-[#0B1117]"
							>
								<ul className="mx-auto max-w-[78rem] px-5 py-2 sm:px-8">
									{SECTIONS.map(({ id, key }) => (
										<li key={id}>
											<a
												href={`#${id}`}
												onClick={() => setMenuOpen(false)}
												aria-current={activeSection === id ? "true" : undefined}
												className={cn(
													"block border-l-2 py-3 pl-4 text-[14px] font-medium",
													activeSection === id
														? "border-[#E85A2A] text-[#0A3D62] dark:text-white"
														: "border-transparent text-slate-600 dark:text-slate-400",
												)}
											>
												{t(key)}
											</a>
										</li>
									))}
								</ul>
								<div className="mx-auto max-w-[78rem] px-5 pb-4 sm:px-8">
									<Link
										href="/login"
										onClick={() => setMenuOpen(false)}
										className={cn(primaryButton, "w-full justify-center", focusRing)}
									>
										{tBtn("login")}
										<ArrowRight className="size-4" aria-hidden="true" />
									</Link>
								</div>
							</motion.nav>
						)}
					</AnimatePresence>
				</header>

				<main id="main">
					{/* Hero */}
					<section className="relative overflow-hidden border-b border-[#DFE7E4] dark:border-white/10">
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -top-52 -right-52 size-[40rem] rounded-full border border-[#0A3D62]/[0.06] dark:border-white/[0.06]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -top-36 -right-36 size-[30rem] rounded-full border border-[#0A3D62]/[0.06] dark:border-white/[0.06]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute -top-20 -right-20 size-[20rem] rounded-full border border-[#0A3D62]/[0.06] dark:border-white/[0.06]"
						/>
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(10,61,98,0.045),transparent_45%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.03),transparent_45%)]"
						/>
						<div
							className={cn(
								container,
								"relative grid gap-12 py-14 md:py-20 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:items-center lg:gap-16 lg:py-24",
							)}
						>
							<div>
								<p className={cn(eyebrow, "flex items-center gap-2")}>
									<span className="size-1.5 rounded-full bg-[#E85A2A]" />
									{t("heroTag")}
								</p>
								<h1 className="mt-5 max-w-[44rem] text-[2.35rem] font-semibold leading-[1.04] tracking-[-0.045em] text-[#0A2E47] sm:text-[3.2rem] lg:text-[3.55rem] dark:text-white">
									{t.rich("heroTitle1", {
										highlight: (chunks) => (
											<span className="relative inline-block">
												{chunks}
												<svg
													aria-hidden="true"
													viewBox="0 0 120 12"
													preserveAspectRatio="none"
													className="absolute -bottom-1.5 left-0 h-2.5 w-full text-[#E85A2A] dark:text-[#FF8A5C]"
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
									<span className="text-[#0A3D62] dark:text-[#FF8A5C]">{t("heroTitle2")}</span>
								</h1>
								<p className="mt-6 max-w-[34rem] text-[15px] leading-7 text-slate-600 dark:text-slate-400">
									{t("heroDesc")}
								</p>

								<div className="mt-8 flex flex-col gap-3 sm:flex-row">
									<Link href="/login" className={cn(primaryButton, focusRing)}>
										{t("heroCtaPrimary")}
										<ArrowRight className="size-4" aria-hidden="true" />
									</Link>
									<a href="#how" className={cn(secondaryButton, focusRing)}>
										{t("heroCtaSecondary")}
									</a>
								</div>

								<p className="mt-6 flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
									<Cpu
										className="size-3.5 shrink-0 text-[#0A3D62] dark:text-slate-400"
										aria-hidden="true"
									/>
									{t("heroSupport")}
								</p>
							</div>

							{/* Pond visual + product preview */}
							<div className="relative mx-auto w-full max-w-[31rem] lg:mx-0 lg:justify-self-end">
								<div className="relative overflow-hidden rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62] shadow-[0_30px_70px_-35px_rgba(10,46,71,0.45)] dark:border-white/10">
									<Image
										src={HERO_IMG}
										alt={t("heroImageAlt")}
										width={1200}
										height={800}
										priority
										sizes="(max-width: 1024px) 100vw, 496px"
										className="h-56 w-full object-cover sm:h-64"
									/>
									<div
										aria-hidden="true"
										className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#062A44]/60 via-transparent to-transparent"
									/>
									<div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-[#062A44]/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
										<Waves className="size-3.5" aria-hidden="true" />
										{t("previewPond")} · {t("previewRegion")}
									</div>
									<span className="absolute top-4 right-4 rounded-full border border-white/20 bg-[#062A44]/70 px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-white/85 uppercase backdrop-blur-sm">
										{t("previewLabel")}
									</span>
								</div>

								<div className="relative z-10 mx-3 -mt-8 rounded-xl bg-white p-5 text-[#0A2E47] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] ring-1 ring-black/[0.04] sm:mx-5 sm:p-6">
									<div className="flex flex-wrap items-start justify-between gap-4">
										<div>
											<p className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
												{t("previewNextFeed")}
											</p>
											<div className="mt-2 flex items-baseline gap-1.5">
												<span className="text-[2rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
													10:00
												</span>
												<span className="text-[13px] font-medium text-slate-500">AM</span>
											</div>
											<p className="mt-2 text-[11.5px] text-slate-500">
												{t("previewNextFeedMeta")}
											</p>
										</div>
										<span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#ECFDF3] px-2.5 py-1 text-[9.5px] font-semibold text-[#067647] ring-1 ring-[#ABEFC6]">
											<span className="size-1.5 rounded-full bg-[#17B26A]" />
											{t("previewStatus")}
										</span>
									</div>

									<div className="mt-6">
										<div className="flex items-baseline justify-between gap-4 text-[11px] font-medium">
											<span className="text-slate-500">{t("previewFeedLevel")}</span>
											<span className="tabular-nums text-[#0A2E47]">
												{t("previewFeedLevelValue")}
											</span>
										</div>
										<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
											<div className="h-full w-[68%] rounded-full bg-[#0A3D62]" />
										</div>
									</div>

									<div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
										<div>
											<p className="text-[9.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
												{t("previewFcr")}
											</p>
											<p className="mt-1 text-[17px] font-semibold tabular-nums">
												{t("previewFcrValue")}
											</p>
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
								</div>
							</div>
						</div>
					</section>

					{/* Problem */}
					<section
						id="problem"
						className="scroll-mt-20 border-b border-[#DFE7E4] bg-white/55 dark:border-white/10 dark:bg-white/[0.02]"
					>
						<div
							className={cn(
								container,
								"grid gap-10 py-16 md:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16",
							)}
						>
							<Reveal className="lg:sticky lg:top-24 lg:self-start">
								<p className={eyebrow}>{t("problemEyebrow")}</p>
								<h2 className={sectionTitle}>{t("problemTitle")}</h2>
								<div className="mt-8">
									<CountUp
										text={t("problemStat")}
										className="text-[3.4rem] leading-none font-semibold tracking-[-0.04em] text-[#E85A2A] tabular-nums sm:text-[4.2rem]"
									/>
								</div>
								<p className="mt-3 max-w-xs text-[12.5px] leading-5 text-slate-500 dark:text-slate-400">
									{t("problemStatLabel")}
								</p>
							</Reveal>

							<RevealList
								as="div"
								className="divide-y divide-[#E1E8E5] border-t border-[#E1E8E5] dark:divide-white/10 dark:border-white/10"
							>
								{[1, 2, 3].map((n) => (
									<RevealItem
										key={n}
										className="grid gap-3 py-6 first:pt-7 last:pb-0 sm:grid-cols-[auto_1fr] sm:gap-6"
									>
										<span className="font-mono text-[11px] font-medium tracking-wider text-[#E85A2A]">
											0{n}
										</span>
										<div>
											<h3 className="text-[14.5px] font-semibold text-[#0A2E47] dark:text-white">
												{t(`problem${n}Title`)}
											</h3>
											<p className="mt-1.5 max-w-prose text-[13px] leading-6 text-slate-600 dark:text-slate-400">
												{t(`problem${n}Body`)}
											</p>
										</div>
									</RevealItem>
								))}
							</RevealList>
						</div>
					</section>

					<HowItWorks />

					{/* Offline-first */}
					<section
						id="offline"
						className="relative scroll-mt-20 overflow-hidden bg-[#0A3D62] text-white"
					>
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
								"relative grid gap-12 py-16 md:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-24",
							)}
						>
							<Reveal>
								<p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-[#FF8A5C] uppercase">
									<span className="size-1.5 rounded-full bg-[#FF8A5C]" />
									{t("navOffline")}
								</p>
								<h2 className="mt-4 max-w-[32rem] text-3xl font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[2.6rem]">
									{t("offlineTitle")}
								</h2>
								<p className="mt-4 max-w-[30rem] text-[14.5px] leading-6 text-white/60">
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

							<RevealList as="div" className="grid gap-4 sm:grid-cols-2">
								{OFFLINE_ICONS.map((Icon, index) => {
									const n = index + 1;
									return (
										<RevealItem
											key={n}
											from={index % 2 === 0 ? "right" : "left"}
											className="rounded-xl border border-white/10 bg-white/[0.04] p-5"
										>
											<span className="flex size-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/70 ring-1 ring-white/10 ring-inset">
												<Icon className="size-[17px]" strokeWidth={1.75} aria-hidden="true" />
											</span>
											<h3 className="mt-4 text-[14px] font-semibold text-white">
												{t(`offline${n}Title`)}
											</h3>
											<p className="mt-1.5 text-[12.5px] leading-5 text-white/55">
												{t(`offline${n}Body`)}
											</p>
										</RevealItem>
									);
								})}
							</RevealList>
						</div>
					</section>

					{/* Hardware */}
					<section
						id="hardware"
						className="scroll-mt-20 border-b border-[#DFE7E4] bg-white/55 dark:border-white/10 dark:bg-white/[0.02]"
					>
						<div
							className={cn(
								container,
								"grid gap-10 py-16 md:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16",
							)}
						>
							<Reveal>
								<p className={eyebrow}>{t("hardwareEyebrow")}</p>
								<h2 className={sectionTitle}>{t("hardwareTitle")}</h2>
								<p className={cn(sectionBody, "max-w-md")}>{t("hardwareDesc")}</p>
							</Reveal>

							<div className="overflow-x-auto">
								<table className="w-full min-w-[34rem] text-left text-[12.5px]">
									<thead className="border-b border-[#E1E8E5] text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase dark:border-white/10 dark:text-slate-400">
										<tr>
											<th scope="col" className="py-3 pr-6 font-semibold">
												{t("hwColPart")}
											</th>
											<th scope="col" className="py-3 font-semibold">
												{t("hwColRole")}
											</th>
										</tr>
									</thead>
									<RevealList as="tbody" className="divide-y divide-[#E1E8E5] dark:divide-white/10">
										{[1, 2, 3, 4, 5, 6].map((n) => (
											<RevealItem as="tr" key={n}>
												<th
													scope="row"
													className="py-3.5 pr-6 text-left font-semibold text-[#0A2E47] dark:text-white"
												>
													{t(`hw${n}Part`)}
												</th>
												<td className="py-3.5 text-slate-600 dark:text-slate-400">
													{t(`hw${n}Role`)}
												</td>
											</RevealItem>
										))}
									</RevealList>
								</table>
							</div>
						</div>
					</section>

					{/* Study design and scope */}
					<section
						id="study"
						className="scroll-mt-20 border-b border-[#DFE7E4] dark:border-white/10"
					>
						<div
							className={cn(
								container,
								"grid gap-12 py-16 md:py-20 lg:grid-cols-2 lg:gap-16 lg:py-24",
							)}
						>
							<div>
								<Reveal>
									<p className={eyebrow}>{t("studyEyebrow")}</p>
									<h2 className={sectionTitle}>{t("studyTitle")}</h2>
									<p className={cn(sectionBody, "max-w-lg")}>{t("studyDesc")}</p>
								</Reveal>

								<RevealList
									as="dl"
									className="mt-8 divide-y divide-[#E1E8E5] border-t border-[#E1E8E5] dark:divide-white/10 dark:border-white/10"
								>
									{[1, 2, 3, 4].map((n) => (
										<RevealItem
											key={n}
											className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr] sm:gap-4"
										>
											<dt className="text-[12px] font-semibold text-[#0A2E47] dark:text-white">
												{t(`study${n}Label`)}
											</dt>
											<dd className="text-[12.5px] leading-5 text-slate-600 dark:text-slate-400">
												{t(`study${n}Value`)}
											</dd>
										</RevealItem>
									))}
								</RevealList>

								<Reveal className="mt-5 border-l-2 border-[#E85A2A] pl-4 text-[12.5px] leading-5 text-slate-500 dark:text-slate-400">
									{t("studyResults")}
								</Reveal>
							</div>

							<div>
								<Reveal>
									<h2 className={sectionTitle}>{t("scopeTitle")}</h2>
								</Reveal>
								<RevealList as="ul" className="mt-6 space-y-4">
									{[1, 2, 3, 4].map((n) => (
										<RevealItem
											as="li"
											key={n}
											className="flex gap-3 text-[13px] leading-6 text-slate-600 dark:text-slate-400"
										>
											<span className="mt-2.5 h-px w-4 shrink-0 bg-[#E85A2A]" />
											{t(`scope${n}`)}
										</RevealItem>
									))}
								</RevealList>
							</div>
						</div>
					</section>

					{/* Project team and paper */}
					<section className="border-b border-[#DFE7E4] bg-white/55 dark:border-white/10 dark:bg-white/[0.02]">
						<div className={cn(container, "grid gap-12 py-16 md:py-20 lg:grid-cols-2 lg:gap-16")}>
							<Reveal>
								<p className={eyebrow}>{t("teamEyebrow")}</p>
								<h2 className={sectionTitle}>{t("teamTitle")}</h2>
								<p className={cn(sectionBody, "max-w-lg")}>{t("teamDesc")}</p>
								<ul className="mt-6 grid gap-2 sm:grid-cols-2">
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

							<Reveal>
								<p className={eyebrow}>{t("paperLabel")}</p>
								<blockquote className="mt-4 border-l-2 border-[#E85A2A] pl-5">
									<p className="max-w-xl text-[16px] font-medium leading-6 text-[#0A2E47] dark:text-white">
										{t("paperTitle")}
									</p>
									<footer className="mt-3 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
										{t("footerProject")}
									</footer>
								</blockquote>
							</Reveal>
						</div>
					</section>

					{/* FAQ */}
					<section id="faq" className="scroll-mt-20">
						<div
							className={cn(
								container,
								"grid gap-10 py-16 md:py-20 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16 lg:py-24",
							)}
						>
							<Reveal className="lg:sticky lg:top-24 lg:self-start">
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

							<Reveal>
								<div className="border-t border-[#E1E8E5] dark:border-white/10">
									{[1, 2, 3, 4, 5].map((n) => (
										<details
											key={n}
											className="group border-b border-[#E1E8E5] dark:border-white/10"
										>
											<summary
												className={cn(
													"flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[14px] font-medium text-[#0A2E47] transition-colors hover:text-[#0A3D62] dark:text-white dark:hover:text-[#FF8A5C] [&::-webkit-details-marker]:hidden",
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
				<footer className="relative overflow-hidden bg-[#0A3D62] text-white">
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
						<div className="grid gap-8 border-b border-white/10 py-14 md:grid-cols-[1fr_auto] md:items-center md:py-16">
							<div>
								<h2 className="max-w-2xl text-[1.9rem] leading-[1.1] font-semibold tracking-[-0.035em] text-white md:text-[2.35rem]">
									{t("ctaTitle")}
								</h2>
								<p className="mt-3 max-w-xl text-[13.5px] leading-6 text-white/55">
									{t("ctaDesc")}
								</p>
							</div>
							<Link
								href="/login"
								className={cn(
									primaryButton,
									"w-full justify-center md:w-auto md:justify-self-end",
									focusRingOnNavy,
								)}
							>
								{tBtn("login")}
								<ArrowRight className="size-4" aria-hidden="true" />
							</Link>
						</div>

						<div className="flex flex-col gap-8 py-8">
							<div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
								<div className="flex items-center gap-3">
									<OptiFeedLogo size={28} variant="white" />
									<div>
										<Image
											src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
											alt="PakaonAI"
											width={120}
											height={28}
											className="h-5 w-auto object-contain brightness-0 invert"
										/>
										<p className="mt-1 text-[10.5px] text-white/55">{t("footerSubtitle")}</p>
									</div>
								</div>

								<nav
									aria-label={t("footerNavLabel")}
									className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/55"
								>
									{SECTIONS.map(({ id, key }) => (
										<a
											key={id}
											href={`#${id}`}
											className={cn(
												"rounded-md transition-colors hover:text-white",
												focusRingOnNavy,
											)}
										>
											{t(key)}
										</a>
									))}
								</nav>

								<fieldset className="m-0 flex w-fit items-center rounded-md border border-white/15 p-0.5">
									<legend className="sr-only">{t("languageLabel")}</legend>
									{(["en", "hil"] as const).map((option) => (
										<button
											key={option}
											type="button"
											onClick={() => switchLocale(option)}
											disabled={option === locale || isLocalePending}
											aria-current={option === locale ? "true" : undefined}
											title={option === "en" ? "English" : "Hiligaynon"}
											className={cn(
												"rounded px-2 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors disabled:cursor-default",
												option === locale
													? "bg-white text-[#0A3D62]"
													: "text-white/55 hover:text-white",
												focusRingOnNavy,
											)}
										>
											{option === "en" ? "EN" : "HIL"}
										</button>
									))}
								</fieldset>
							</div>

							<div className="flex flex-col gap-2 border-t border-white/10 pt-5 text-[10.5px] text-white/55 sm:flex-row sm:items-center sm:justify-between">
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
