"use client";

import { useRouter } from "@/i18n/routing";
import { calculateFcrFeed } from "@/lib/actions/fcr";
import { setGrowthTarget } from "@/lib/actions/growth-target";
import { Calculator, CheckCircle2, Clock, Scale, Target, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface FcrResult {
	totalFeedNeededKg: number;
	dailyFeedRationKg: number;
	totalBiomassGainKg: number;
	suggestedFeedingRatePct: number;
	gramsPerFeeding: number | null;
	latestFcr: number;
}

interface FcrRequestSnapshot {
	targetWeightKg: number;
	population: number;
}

interface FcrCalculatorProps {
	latestFcr: number;
	/** The pond this card is shown for; the action never guesses. */
	pondId: string;
	/** Pond fish count, prefilled so the farmer does not retype it. */
	population: number | null;
	feedsPerDay?: number | null;
	/** A target belongs to a cycle; without one there is nothing to attach it to. */
	canSetTarget?: boolean;
}

export function FcrCalculator({
	latestFcr,
	pondId,
	population,
	feedsPerDay,
	canSetTarget = false,
}: FcrCalculatorProps) {
	const t = useTranslations("dashboard.fcrCalculator");
	const router = useRouter();
	const [currentWeight, setCurrentWeight] = useState("");
	const [targetWeight, setTargetWeight] = useState("");
	const [fishCount, setFishCount] = useState(population ? String(population) : "");
	const [days, setDays] = useState("");
	const [result, setResult] = useState<FcrResult | null>(null);
	const [request, setRequest] = useState<FcrRequestSnapshot | null>(null);
	const [savedWeightKg, setSavedWeightKg] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [isSavingTarget, startSaveTarget] = useTransition();

	// Right padding leaves room for the unit suffix; hiding the native number
	// spinners keeps them from being painted underneath that suffix.
	const numberInputClass =
		"w-full rounded-xl border border-gray-200 bg-[#F4F7F6] py-3 pl-4 pr-12 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 transition-all focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 [appearance:textfield] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

	const handleCalculate = async () => {
		const current = Number.parseFloat(currentWeight);
		const target = Number.parseFloat(targetWeight);
		const count = Number.parseInt(fishCount, 10);
		const daysNum = Number.parseInt(days, 10);

		if (
			!current ||
			!target ||
			!count ||
			!daysNum ||
			current <= 0 ||
			target <= 0 ||
			count <= 0 ||
			daysNum <= 0
		) {
			toast.error(t("error"));
			return;
		}

		setLoading(true);
		try {
			const res = await calculateFcrFeed({
				pondId,
				currentWeightKg: current,
				targetWeightKg: target,
				population: count,
				days: daysNum,
				feedsPerDay: feedsPerDay ?? null,
			});
			if (res.success && "totalFeedNeededKg" in res) {
				setResult(res);
				setRequest({ targetWeightKg: target, population: count });
				setSavedWeightKg(null);
			} else {
				toast.error(res.error ?? t("error"));
			}
		} catch {
			toast.error(t("error"));
		} finally {
			setLoading(false);
		}
	};

	const handleSetTarget = () => {
		if (!canSetTarget || request === null) return;
		startSaveTarget(async () => {
			const res = await setGrowthTarget(pondId, {
				targetWeightKg: request.targetWeightKg,
				population: request.population,
			});
			if (res.success) {
				setSavedWeightKg(request.targetWeightKg);
				toast.success(t("targetSaved", { weight: request.targetWeightKg }));
				router.refresh();
			} else {
				toast.error(res.error ?? t("targetError"));
			}
		});
	};

	return (
		<div
			className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-900"
			data-help="fcr-calculator"
		>
			<div className="flex items-center gap-3 mb-6">
				<div className="w-12 h-12 rounded-2xl bg-[#E85A2A]/10 flex items-center justify-center">
					<Calculator className="w-6 h-6 text-[#E85A2A]" />
				</div>
				<div>
					<h3 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">{t("title")}</h3>
					<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("desc")}</p>
					<p className="mt-1 text-[11px] font-semibold text-[#3D5568] dark:text-gray-400">
						{latestFcr > 0 ? t("usingFcr", { fcr: latestFcr.toFixed(2) }) : t("noFcr")}
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
				<div>
					<label
						htmlFor="currentWeight"
						className="block text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-1.5"
					>
						{t("currentWeight")}
					</label>
					<div className="relative">
						<input
							id="currentWeight"
							type="number"
							value={currentWeight}
							onChange={(e) => setCurrentWeight(e.target.value)}
							placeholder="0.00"
							className={numberInputClass}
						/>
						<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-xs font-bold text-[#3D5568] dark:text-gray-400">
							{t("kg")}
						</span>
					</div>
				</div>

				<div>
					<label
						htmlFor="target"
						className="block text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-1.5"
					>
						{t("targetWeight")}
					</label>
					<div className="relative">
						<input
							id="target"
							type="number"
							value={targetWeight}
							onChange={(e) => setTargetWeight(e.target.value)}
							placeholder="0.00"
							className={numberInputClass}
						/>
						<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-xs font-bold text-[#3D5568] dark:text-gray-400">
							{t("kg")}
						</span>
					</div>
				</div>

				<div>
					<label
						htmlFor="fishCount"
						className="block text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-1.5"
					>
						{t("population")}
					</label>
					<div className="relative">
						<input
							id="fishCount"
							type="number"
							value={fishCount}
							onChange={(e) => setFishCount(e.target.value)}
							placeholder="0"
							className={numberInputClass}
						/>
						<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-xs font-bold text-[#3D5568] dark:text-gray-400">
							{t("fish")}
						</span>
					</div>
				</div>

				<div>
					<label
						htmlFor="days"
						className="block text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-1.5"
					>
						{t("daysToTarget")}
					</label>
					<div className="relative">
						<input
							id="days"
							type="number"
							value={days}
							onChange={(e) => setDays(e.target.value)}
							placeholder="0"
							className={numberInputClass}
						/>
						<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-xs font-bold text-[#3D5568] dark:text-gray-400">
							{t("days")}
						</span>
					</div>
				</div>
			</div>

			<button
				type="button"
				onClick={handleCalculate}
				disabled={loading}
				className="w-full bg-[#E85A2A] hover:bg-[#d14e22] text-white font-bold py-3 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2"
			>
				{loading ? t("calculating") : t("calculate")}
			</button>

			{result && (
				<div className="mt-6 p-4 bg-[#F4F7F6] rounded-2xl border border-[#0A3D62]/5 dark:border-gray-700/50 dark:bg-gray-800/60">
					<p className="text-xs font-bold text-[#3D5568] dark:text-gray-400 uppercase tracking-wider mb-3">
						{t("results")}
					</p>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-[#E85A2A]/10 flex items-center justify-center">
								<Scale className="w-5 h-5 text-[#E85A2A]" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400 uppercase">
									{t("totalFeed")}
								</p>
								<p className="text-lg font-black text-[#0A3D62] dark:text-gray-100">
									{result.totalFeedNeededKg} {t("kg")}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center dark:bg-blue-500/15">
								<Clock className="w-5 h-5 text-blue-600 dark:text-blue-300" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400 uppercase">
									{t("dailyRation")}
								</p>
								<p className="text-lg font-black text-[#0A3D62] dark:text-gray-100">
									{result.dailyFeedRationKg} {t("kg")}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center dark:bg-green-500/15">
								<TrendingUp className="w-5 h-5 text-green-600 dark:text-green-300" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400 uppercase">
									{t("biomassGain")}
								</p>
								<p className="text-lg font-black text-[#0A3D62] dark:text-gray-100">
									{result.totalBiomassGainKg} {t("kg")}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center dark:bg-amber-500/15">
								<Calculator className="w-5 h-5 text-amber-600 dark:text-amber-300" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] dark:text-gray-400 uppercase">
									{t("suggestedRate")}
								</p>
								<p className="text-lg font-black text-[#0A3D62] dark:text-gray-100">
									{result.suggestedFeedingRatePct}%
								</p>
							</div>
						</div>
					</div>
					{result.gramsPerFeeding !== null && (
						<p className="mt-3 text-xs font-bold text-[#3D5568] dark:text-gray-400">
							{t("perMeal", { grams: result.gramsPerFeeding })}
						</p>
					)}

					<div className="mt-4 flex flex-col gap-3 border-t border-[#0A3D62]/10 pt-4 dark:border-gray-700/50 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="text-xs font-semibold text-[#3D5568] dark:text-gray-400">
								{canSetTarget ? t("targetHint") : t("targetNeedsCycle")}
							</p>
							{savedWeightKg !== null && (
								<p className="mt-1 flex items-center gap-1 text-xs font-bold text-green-700 dark:text-green-400">
									<CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
									{t("targetSavedShort", { weight: savedWeightKg })}
								</p>
							)}
						</div>
						<button
							type="button"
							onClick={handleSetTarget}
							disabled={!canSetTarget || isSavingTarget}
							className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#164e7c] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2 dark:bg-[#1f66a0] dark:hover:bg-[#2a7ab5]"
						>
							<Target aria-hidden="true" className="h-4 w-4" />
							{isSavingTarget ? t("settingTarget") : t("setAsTarget")}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
