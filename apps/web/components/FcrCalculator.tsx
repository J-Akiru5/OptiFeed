"use client";

import { calculateFcrFeed } from "@/lib/actions/fcr";
import { Calculator, Clock, Scale, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface FcrResult {
	totalFeedNeededKg: number;
	dailyFeedRationKg: number;
	totalBiomassGainKg: number;
	suggestedFeedingRatePct: number;
	latestFcr: number;
}

export function FcrCalculator({ latestFcr }: { latestFcr: number }) {
	const t = useTranslations("dashboard.fcrCalculator");
	const [currentBiomass, setCurrentBiomass] = useState("");
	const [targetWeight, setTargetWeight] = useState("");
	const [days, setDays] = useState("");
	const [result, setResult] = useState<FcrResult | null>(null);
	const [loading, setLoading] = useState(false);

	const handleCalculate = async () => {
		const biomass = Number.parseFloat(currentBiomass);
		const target = Number.parseFloat(targetWeight);
		const daysNum = Number.parseInt(days, 10);

		if (!biomass || !target || !daysNum || biomass <= 0 || target <= 0 || daysNum <= 0) {
			toast.error(t("error"));
			return;
		}

		setLoading(true);
		try {
			const res = await calculateFcrFeed({
				currentBiomassKg: biomass,
				targetWeightKg: target,
				days: daysNum,
				currentFcr: latestFcr,
			});
			if (res.success && "totalFeedNeededKg" in res) {
				setResult(res);
			} else {
				toast.error(res.error ?? t("error"));
			}
		} catch {
			toast.error(t("error"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-12 h-12 rounded-2xl bg-[#E85A2A]/10 flex items-center justify-center">
					<Calculator className="w-6 h-6 text-[#E85A2A]" />
				</div>
				<div>
					<h3 className="text-lg font-black text-[#0A3D62]">{t("title")}</h3>
					<p className="text-xs text-[#3D5568]">{t("desc")}</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
				<div>
					<label
						htmlFor="biomass"
						className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
					>
						{t("currentBiomass")}
					</label>
					<div className="relative">
						<input
							id="biomass"
							type="number"
							value={currentBiomass}
							onChange={(e) => setCurrentBiomass(e.target.value)}
							placeholder="0.00"
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 focus:border-[#E85A2A] transition-all"
						/>
						<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#3D5568]">
							kg
						</span>
					</div>
				</div>

				<div>
					<label
						htmlFor="target"
						className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
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
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 focus:border-[#E85A2A] transition-all"
						/>
						<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#3D5568]">
							kg
						</span>
					</div>
				</div>

				<div>
					<label
						htmlFor="days"
						className="block text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-1.5"
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
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/50 focus:border-[#E85A2A] transition-all"
						/>
						<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#3D5568]">
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
				<div className="mt-6 p-4 bg-[#F4F7F6] rounded-2xl border border-[#0A3D62]/5">
					<p className="text-xs font-bold text-[#3D5568] uppercase tracking-wider mb-3">
						{t("results")}
					</p>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-[#E85A2A]/10 flex items-center justify-center">
								<Scale className="w-5 h-5 text-[#E85A2A]" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] uppercase">{t("totalFeed")}</p>
								<p className="text-lg font-black text-[#0A3D62]">{result.totalFeedNeededKg} kg</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
								<Clock className="w-5 h-5 text-blue-600" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] uppercase">{t("dailyRation")}</p>
								<p className="text-lg font-black text-[#0A3D62]">{result.dailyFeedRationKg} kg</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
								<TrendingUp className="w-5 h-5 text-green-600" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] uppercase">{t("biomassGain")}</p>
								<p className="text-lg font-black text-[#0A3D62]">{result.totalBiomassGainKg} kg</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
								<Calculator className="w-5 h-5 text-amber-600" />
							</div>
							<div>
								<p className="text-[10px] font-bold text-[#3D5568] uppercase">
									{t("suggestedRate")}
								</p>
								<p className="text-lg font-black text-[#0A3D62]">
									{result.suggestedFeedingRatePct}%
								</p>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
