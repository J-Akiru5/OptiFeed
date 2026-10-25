"use client";

import { Reveal } from "@/components/landing/Reveal";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { animate, motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

const STEPS = [1, 2, 3, 4] as const;

const ROWS = [
	{ label: "calcSample", value: "calcSampleValue", from: 1, logged: true },
	{ label: "calcFish", value: "calcFishValue", from: 1, logged: true },
	{ label: "calcBiomass", value: "calcBiomassValue", from: 2, logged: false },
	{ label: "calcRate", value: "calcRateValue", from: 3, logged: false },
	{ label: "calcDaily", value: "calcDailyValue", from: 3, logged: false },
	{ label: "calcFeeds", value: "calcFeedsValue", from: 3, logged: false },
] as const;

/** Counts the first run of digits in `text` up from 0 when `run` turns true. */
function AnimatedValue({ text, run }: { text: string; run: boolean }) {
	const reduced = useReducedMotion();
	const match = text.match(/^(\D*)([\d,]+)(.*)$/);
	const target = match ? Number(match[2].replace(/,/g, "")) : 0;
	const hasNumber = match !== null;
	const [shown, setShown] = useState(reduced ? target : 0);

	useEffect(() => {
		if (!hasNumber) return;
		if (reduced) {
			setShown(target);
			return;
		}
		if (!run) {
			setShown(0);
			return;
		}
		const controls = animate(0, target, {
			duration: 0.8,
			ease: "easeOut",
			onUpdate: (v) => setShown(Math.round(v)),
		});
		return () => controls.stop();
	}, [run, target, reduced, hasNumber]);

	if (!match) return <>{text}</>;
	return (
		<>
			{match[1]}
			{shown.toLocaleString("en-US")}
			{match[3]}
		</>
	);
}

function FeederDemo({ active, caption }: { active: boolean; caption: string }) {
	const reduced = useReducedMotion();
	const animated = active && !reduced;
	const pellets = [0, 1, 2, 3];

	return (
		<div
			className={cn(
				"mt-4 flex items-center gap-4 rounded-xl border border-white/15 bg-[#0A3D62] p-3 text-white transition-opacity duration-500",
				active ? "opacity-100" : "opacity-60",
			)}
		>
			<svg viewBox="0 0 96 80" className="h-16 w-20 shrink-0" role="img" aria-label={caption}>
				<title>{caption}</title>
				<path d="M14 6h44l-8 26H22z" fill="#12588c" stroke="#9fc3dc" strokeWidth="1.5" />
				<rect x="30" y="32" width="12" height="8" fill="#9fc3dc" />
				<motion.g
					style={{ originX: "36px", originY: "46px" }}
					animate={animated ? { rotate: 360 } : { rotate: 0 }}
					transition={
						animated
							? { duration: 1.4, ease: "linear", repeat: Number.POSITIVE_INFINITY }
							: { duration: 0 }
					}
				>
					<circle cx="36" cy="46" r="7" fill="none" stroke="#E85A2A" strokeWidth="2" />
					<path d="M36 39v14M29 46h14" stroke="#E85A2A" strokeWidth="2" strokeLinecap="round" />
				</motion.g>
				{pellets.map((i) => (
					<motion.circle
						key={i}
						cx={58 + (i % 2) * 8}
						r="2.5"
						fill="#E85A2A"
						initial={{ cy: 46, opacity: 0 }}
						animate={
							animated
								? { cy: [46, 74], opacity: [0, 1, 1, 0] }
								: { cy: 70 + (i % 2) * 3, opacity: active ? 1 : 0.5 }
						}
						transition={
							animated
								? {
										duration: 1.2,
										ease: "easeIn",
										repeat: Number.POSITIVE_INFINITY,
										delay: i * 0.3,
									}
								: { duration: 0 }
						}
					/>
				))}
				<path d="M44 46h14" stroke="#9fc3dc" strokeWidth="2" strokeLinecap="round" />
			</svg>
			<p className="text-[10px] font-semibold tracking-[0.12em] text-white/60 uppercase">
				{caption}
			</p>
		</div>
	);
}

export function HowItWorks() {
	const t = useTranslations("landing");
	const reduced = useReducedMotion();
	const [activeStep, setActiveStep] = useState(1);
	const stepsRef = useRef<HTMLOListElement>(null);
	const stepEls = useRef<(HTMLLIElement | null)[]>([]);

	const { scrollYProgress } = useScroll({
		target: stepsRef,
		offset: ["start 60%", "end 60%"],
	});
	const lineScale = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 });

	useEffect(() => {
		const els = stepEls.current.filter((el): el is HTMLLIElement => el !== null);
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveStep(Number((entry.target as HTMLElement).dataset.step));
					}
				}
			},
			{ rootMargin: "-45% 0px -45% 0px", threshold: 0 },
		);
		for (const el of els) observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<section
			id="how"
			className="scroll-mt-20 border-b border-[#DFE7E4] py-16 md:py-24 dark:border-white/10"
		>
			<div className="mx-auto w-full max-w-[78rem] px-5 sm:px-8 lg:px-10">
				<Reveal>
					<p className="text-[11px] font-semibold tracking-[0.18em] text-[#E85A2A] uppercase dark:text-[#FF8A5C]">
						{t("howEyebrow")}
					</p>
					<h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-[#0A2E47] sm:text-[2.4rem] dark:text-white">
						{t("howTitle")}
					</h2>
					<p className="mt-4 max-w-2xl text-[14.5px] leading-6 text-slate-600 dark:text-slate-400">
						{t("howDesc")}
					</p>
				</Reveal>

				<div className="mt-12 grid gap-12 lg:grid-cols-[1.2fr_0.8fr]">
					<div className="relative lg:pb-[30vh]">
						<div
							aria-hidden="true"
							className="absolute top-6 bottom-6 left-6 hidden w-0.5 -translate-x-1/2 bg-[#DDE5E1] sm:block lg:bottom-[calc(30vh+1.5rem)] dark:bg-white/10"
						>
							<motion.div
								className="h-full w-full origin-top bg-[#E85A2A]"
								style={{ scaleY: reduced ? 1 : lineScale }}
							/>
						</div>
						<ol ref={stepsRef} className="space-y-10 lg:space-y-0">
							{STEPS.map((n, i) => {
								const isActive = activeStep === n;
								const isPast = activeStep > n;
								return (
									<li
										key={n}
										data-step={n}
										ref={(el) => {
											stepEls.current[i] = el;
										}}
										className="flex gap-5 lg:min-h-[42vh] lg:items-start lg:pt-2"
										aria-current={isActive ? "step" : undefined}
									>
										<motion.span
											animate={{ scale: isActive ? 1.1 : 1 }}
											transition={{ type: "spring", stiffness: 400, damping: 22 }}
											className={cn(
												"relative z-10 flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white transition-colors duration-300",
												isActive
													? "bg-[#E85A2A]"
													: isPast
														? "bg-[#0A3D62]"
														: "bg-[#0A3D62]/10 text-[#0A3D62] dark:bg-white/10 dark:text-white/50",
											)}
										>
											{isPast ? <Check className="size-5" aria-hidden="true" /> : n}
										</motion.span>
										<motion.div
											animate={{
												opacity: isActive || reduced ? 1 : 0.55,
												x: isActive ? 4 : 0,
											}}
											transition={{ duration: 0.3 }}
										>
											<h3 className="text-[17px] font-semibold text-[#0A2E47] dark:text-white">
												{t(`step${n}Title`)}
											</h3>
											<p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-slate-600 dark:text-slate-400">
												{t(`step${n}Body`)}
											</p>
										</motion.div>
									</li>
								);
							})}
						</ol>
					</div>

					<div className="self-start lg:sticky lg:top-24">
						<figure className="rounded-2xl border border-[#DFE7E4] bg-white p-5 shadow-[0_24px_60px_-36px_rgba(10,46,71,0.35)] sm:p-6 dark:border-white/10 dark:bg-[#0C1319]">
							<figcaption className="text-[15px] font-semibold text-[#0A2E47] dark:text-white">
								{t("calcTitle")}
							</figcaption>
							<p className="mt-1 mb-4 text-[9.5px] font-semibold tracking-[0.12em] text-slate-500 uppercase dark:text-slate-400">
								{t("calcBadge")}
							</p>
							<dl className="divide-y divide-[#E7EDEA] text-[12.5px] dark:divide-white/10">
								{ROWS.map(({ label, value, from, logged }) => {
									const shown = reduced || activeStep >= from;
									const justLogged = logged && activeStep >= 2;
									return (
										<motion.div
											key={label}
											animate={{ opacity: shown ? 1 : 0.35 }}
											transition={{ duration: 0.35 }}
											className="flex items-baseline justify-between gap-4 py-2.5"
										>
											<dt className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
												{t(label)}
												{justLogged && (
													<Check className="size-3.5 text-[#17B26A]" aria-label={t("calcLogged")} />
												)}
											</dt>
											<dd className="text-right font-mono font-semibold text-[#0A2E47] tabular-nums dark:text-white">
												{shown ? <AnimatedValue text={t(value)} run={shown} /> : "···"}
											</dd>
										</motion.div>
									);
								})}
							</dl>
							<motion.div
								animate={{
									backgroundColor: activeStep >= 4 || reduced ? "#E85A2A" : "#CBD5DC",
									scale: activeStep === 4 ? 1.02 : 1,
								}}
								transition={{ duration: 0.35 }}
								className="mt-3 flex items-baseline justify-between gap-4 rounded-xl px-4 py-3 text-white"
							>
								<span className="text-[12px] font-semibold">{t("calcPortion")}</span>
								<span className="font-mono text-2xl font-semibold tabular-nums">
									{activeStep >= 4 || reduced ? (
										<AnimatedValue text={t("calcPortionValue")} run={activeStep >= 4} />
									) : (
										"···"
									)}
								</span>
							</motion.div>
							<FeederDemo active={activeStep === 4} caption={t("demoCaption")} />
						</figure>
					</div>
				</div>
			</div>
		</section>
	);
}
