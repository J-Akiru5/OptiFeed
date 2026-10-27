"use client";

import { Link } from "@/i18n/routing";
import { applyGrowthPlan } from "@/lib/actions/growth-plan";
import type { GrowthPlan } from "@/lib/growth-plan";
import { CheckCircle2, Loader2, Scale, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface GrowthPlanCardProps {
	plan: GrowthPlan;
	pondId: string;
	canWrite: boolean;
}

function formatMoney(value: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-PH", {
			style: "currency",
			currency,
			maximumFractionDigits: 0,
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(0)}`;
	}
}

export function GrowthPlanCard({ plan, pondId, canWrite }: GrowthPlanCardProps) {
	const t = useTranslations("dashboard.growth.growthPlan");
	const [confirming, setConfirming] = useState(false);
	const [applied, setApplied] = useState(false);
	const [isPending, startTransition] = useTransition();

	if (plan.status === "noCycle") {
		return (
			<section
				className="rounded-[32px] border border-dashed border-[#0A3D62]/20 bg-white p-6 dark:border-white/10 dark:bg-gray-900"
				data-help="growth-plan"
			>
				<div className="flex items-start gap-3">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<Target className="h-6 w-6" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-black text-gray-900 dark:text-gray-100">{t("title")}</p>
						<p className="mt-0.5 max-w-xl text-xs text-gray-500 dark:text-gray-400">
							{t("noCycle")}
						</p>
						<Link
							href="/dashboard/harvest"
							className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#164e7c]"
						>
							{t("startCycle")}
						</Link>
					</div>
				</div>
			</section>
		);
	}

	if (plan.status === "noTarget" || plan.status === "noWeight") {
		return (
			<section
				className="rounded-[32px] border border-dashed border-[#0A3D62]/20 bg-white p-6 dark:border-white/10 dark:bg-gray-900"
				data-help="growth-plan"
			>
				<div className="flex items-start gap-3">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<Target className="h-6 w-6" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-black text-gray-900 dark:text-gray-100">{t("title")}</p>
						<p className="mt-0.5 max-w-xl text-xs text-gray-500 dark:text-gray-400">
							{plan.status === "noTarget" ? t("noTarget") : t("noWeight")}
						</p>
						<Link
							href={plan.status === "noTarget" ? "/dashboard/harvest" : "/dashboard/log-sample"}
							className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#164e7c]"
						>
							{plan.status === "noTarget" ? t("editPlan") : t("logSample")}
						</Link>
					</div>
				</div>
			</section>
		);
	}

	const trackLabel =
		plan.track === "ahead"
			? t("ahead")
			: plan.track === "behind"
				? t("behind")
				: plan.track === "onTrack"
					? t("onTrack")
					: t("unknown");
	const trackClass =
		plan.track === "ahead"
			? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
			: plan.track === "behind"
				? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
				: plan.track === "onTrack"
					? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
					: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

	const targetWeight = plan.targetWeightG ?? 0;
	const currentWeight = plan.currentWeightG ?? 0;
	const progress = plan.progressPct ?? 0;
	const trajectory = plan.trajectory;
	const chartMax =
		Math.max(...trajectory.map((point) => point.targetWeightG), targetWeight, currentWeight) * 1.08;
	const chartMin =
		Math.min(...trajectory.map((point) => point.targetWeightG), currentWeight) * 0.92;
	const chartRange = Math.max(1, chartMax - chartMin);
	const chartPoints = trajectory
		.map((point, index) => {
			const x = trajectory.length <= 1 ? 0 : (index / (trajectory.length - 1)) * 400;
			const y = 110 - ((point.targetWeightG - chartMin) / chartRange) * 100;
			return `${x},${y}`;
		})
		.join(" ");
	const targetY = 110 - ((targetWeight - chartMin) / chartRange) * 100;
	const initializing = !plan.hasPriorAdjustment;
	const displayGrams = initializing
		? plan.recommendedGramsPerFeeding
		: plan.applicableGramsPerFeeding;

	const apply = () => {
		if (!canWrite || displayGrams === null) return;
		startTransition(async () => {
			const result = await applyGrowthPlan(pondId, {
				grams: displayGrams ?? undefined,
				initialize: initializing,
			});
			if (result.success) {
				setApplied(true);
				setConfirming(false);
				toast.success(initializing ? t("initialized") : t("applied"));
			} else {
				toast.error(result.error ?? t("applyError"));
			}
		});
	};

	return (
		<section
			className="overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-900"
			data-help="growth-plan"
		>
			<div className="border-b border-gray-100 bg-[#0A3D62] px-6 py-5 text-white dark:border-gray-700/50">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex items-start gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
							<Target className="h-6 w-6" />
						</div>
						<div>
							<p className="text-xs font-extrabold uppercase tracking-widest text-blue-200">
								{t("title")}
							</p>
							<p className="mt-1 text-2xl font-black">
								{targetWeight.toFixed(0)} g
								<span className="ml-2 text-sm font-semibold text-blue-100">{plan.targetDate}</span>
							</p>
							<p className="mt-1 text-xs text-blue-100">{t("subtitle")}</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<span
							className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${trackClass}`}
						>
							{plan.track === "ahead" ? (
								<TrendingUp className="mr-1 h-3.5 w-3.5" />
							) : plan.track === "behind" ? (
								<TrendingDown className="mr-1 h-3.5 w-3.5" />
							) : null}
							{trackLabel}
						</span>
						<span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
							{plan.daysToHarvest !== null && plan.daysToHarvest < 0
								? t("overdue", { days: Math.abs(plan.daysToHarvest) })
								: t("daysLeft", { days: plan.daysToHarvest ?? 0 })}
						</span>
					</div>
				</div>
			</div>

			<div className="space-y-5 p-6">
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
						<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
							{t("current")}
						</p>
						<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
							{currentWeight.toFixed(0)} g
						</p>
					</div>
					<div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
						<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
							{t("expected")}
						</p>
						<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
							{plan.expectedWeightG !== null ? `${plan.expectedWeightG.toFixed(0)} g` : "—"}
						</p>
					</div>
					<div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
						<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
							{t("projected")}
						</p>
						<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
							{plan.projectedHarvestWeightG !== null
								? `${plan.projectedHarvestWeightG.toFixed(0)} g`
								: "—"}
						</p>
					</div>
					<div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
						<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
							{t("gap")}
						</p>
						<p className="mt-1 text-xl font-black text-[var(--ofd-base-deep)]">
							{plan.trackDeltaG !== null
								? `${plan.trackDeltaG > 0 ? "+" : ""}${plan.trackDeltaG.toFixed(0)} g`
								: "—"}
						</p>
					</div>
				</div>

				<div>
					<div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-gray-400">
						<span>{t("today")}</span>
						<span>{t("harvest")}</span>
					</div>
					<div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
						<div
							className="h-full rounded-full bg-[#E85A2A]"
							style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
						/>
					</div>
				</div>

				{trajectory.length > 1 && (
					<div>
						<p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
							{t("trajectory")}
						</p>
						<svg
							viewBox="0 0 400 120"
							className="h-28 w-full"
							role="img"
							aria-label={t("trajectory")}
						>
							<line
								x1="0"
								y1={targetY}
								x2="400"
								y2={targetY}
								stroke="currentColor"
								className="text-[#0A3D62]/15"
								strokeDasharray="4 4"
							/>
							<polyline
								fill="none"
								stroke="#E85A2A"
								strokeWidth="3"
								points={chartPoints}
								strokeLinejoin="round"
								strokeLinecap="round"
							/>
						</svg>
					</div>
				)}

				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("requiredGain")}
						</p>
						<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">
							{plan.requiredDailyGainG !== null
								? `${plan.requiredDailyGainG.toFixed(1)} g/day`
								: "—"}
						</p>
					</div>
					<div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("requiredFeed")}
						</p>
						<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">
							{plan.requiredDailyFeedKg !== null
								? `${plan.requiredDailyFeedKg.toFixed(2)} kg/day`
								: "—"}
						</p>
					</div>
					<div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("requiredRate")}
						</p>
						<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">
							{plan.requiredFeedingRatePct !== null
								? `${plan.requiredFeedingRatePct.toFixed(2)}%`
								: "—"}
						</p>
					</div>
					<div className="rounded-xl border border-gray-100 p-3 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("recommended")}
						</p>
						<p className="mt-1 text-sm font-black text-[var(--ofd-base-deep)]">
							{plan.recommendedGramsPerFeeding !== null
								? `${plan.recommendedGramsPerFeeding.toFixed(0)} g`
								: "—"}
						</p>
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-2xl border border-gray-100 p-4 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("currentDevice")}
						</p>
						<p className="mt-1 text-lg font-black text-[var(--ofd-base-deep)]">
							{plan.currentGramsPerFeeding !== null
								? `${plan.currentGramsPerFeeding.toFixed(0)} g`
								: "—"}
						</p>
					</div>
					<div className="rounded-2xl border border-gray-100 p-4 dark:border-gray-700/50">
						<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
							{t("feedBudget")}
						</p>
						<p className="mt-1 text-lg font-black text-[var(--ofd-base-deep)]">
							{plan.feed.remainingFeedKg !== null
								? `${plan.feed.remainingFeedKg.toFixed(1)} kg`
								: "—"}
						</p>
						{plan.feed.estimatedRemainingCost !== null && (
							<p className="text-xs font-semibold text-gray-500">
								{t("feedCost")}: {formatMoney(plan.feed.estimatedRemainingCost, plan.feed.currency)}
							</p>
						)}
					</div>
				</div>

				{displayGrams !== null && (initializing ? plan.device.feasible : plan.adjustmentAllowed) ? (
					<div className="rounded-2xl border border-[#E85A2A]/20 bg-[#E85A2A]/5 p-4">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p className="text-sm font-black text-[#0A3D62] dark:text-blue-200">
									{initializing ? t("initialFeeding") : t("nextAdjustment")}:{" "}
									{displayGrams.toFixed(1)} g/meal
								</p>
								<p className="text-xs text-gray-600 dark:text-gray-300">
									{initializing
										? t("initialHint")
										: t("adjustmentHint", {
												pct: plan.maxChangePct * 100,
												days: 15,
											})}
								</p>
							</div>
							{!confirming && !applied && (
								<button
									type="button"
									onClick={() => setConfirming(true)}
									disabled={!canWrite}
									className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E85A2A] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#d14e22] disabled:opacity-50"
								>
									<Scale className="h-4 w-4" />
									{initializing
										? t("initializeApply", { grams: displayGrams.toFixed(1) })
										: t("apply", { grams: displayGrams.toFixed(1) })}
								</button>
							)}
							{applied && (
								<span className="inline-flex items-center gap-1 text-sm font-bold text-green-600">
									<CheckCircle2 className="h-4 w-4" />{" "}
									{initializing ? t("initialized") : t("applied")}
								</span>
							)}
						</div>

						{confirming && !applied && (
							<div className="mt-4 rounded-xl border border-[#E85A2A]/20 bg-white p-4 dark:bg-gray-900">
								<p className="text-sm font-black text-[#0A3D62] dark:text-blue-200">
									{initializing ? t("initializeTitle") : t("applyTitle")}
								</p>
								<p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
									{initializing
										? t("initializeDesc", { to: displayGrams.toFixed(1) })
										: t("applyDesc", {
												from: plan.currentGramsPerFeeding?.toFixed(1) ?? "—",
												to: displayGrams.toFixed(1),
											})}
								</p>
								<div className="mt-3 flex gap-2">
									<button
										type="button"
										onClick={apply}
										disabled={isPending}
										className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A3D62] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
									>
										{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
										{isPending ? t("applying") : t("confirm")}
									</button>
									<button
										type="button"
										onClick={() => setConfirming(false)}
										disabled={isPending}
										className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
									>
										{t("cancel")}
									</button>
								</div>
							</div>
						)}
					</div>
				) : (
					<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
						{plan.adjustmentBlock === "adjustmentWindow" && plan.nextAdjustmentDate
							? t("window", { date: plan.nextAdjustmentDate })
							: plan.adjustmentBlock === "deviceCap"
								? `${t("deviceCap", {
										required: plan.device.requiredGramsPerFeeding?.toFixed(0) ?? "—",
										max: plan.device.maxGramsPerFeeding.toFixed(0),
									})} ${t("deviceCapHint")}`
								: plan.adjustmentBlock === "noSample"
									? t("noWeight")
									: plan.adjustmentBlock === "noDevice"
										? t("noDevice")
										: t("noAdjustment")}
					</div>
				)}

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
					<span>
						{t("confidence")}: {t(`confidence_${plan.confidence}`)}
					</span>
					<span>{t("fcr", { fcr: plan.feed.fcrAssumption })}</span>
					{plan.density.fishPerM2 !== null && (
						<span>{t("density", { density: plan.density.fishPerM2.toFixed(1) })}</span>
					)}
					<Link
						href="/dashboard/harvest"
						className="font-bold text-[var(--ofd-base)] hover:underline"
					>
						{t("editPlan")}
					</Link>
					<Link
						href="/dashboard/log-sample"
						className="font-bold text-[var(--ofd-base)] hover:underline"
					>
						{t("logSample")}
					</Link>
				</div>

				{plan.density.advisory === "high" && (
					<p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
						{t("densityHigh", { density: plan.density.fishPerM2?.toFixed(1) ?? "—" })}
					</p>
				)}
				{plan.density.advisory === "unknown" && (
					<p className="text-xs font-medium text-gray-500 dark:text-gray-400">
						{t("densityUnknown")}
					</p>
				)}
			</div>
		</section>
	);
}
