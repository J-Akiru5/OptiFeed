"use client";

import { applyPredictedGrams } from "@/lib/actions/prediction";
import { apiPost } from "@/lib/api-client";
import type { FeedingPrediction, PredictionConfidence } from "@/lib/prediction";
import { Brain, Check, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface FeedingPredictionCardProps {
	deviceId: string;
	initialPrediction: FeedingPrediction;
}

const confidenceClass: Record<PredictionConfidence, string> = {
	high: "bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300",
	medium: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
	low: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

export function FeedingPredictionCard({ deviceId, initialPrediction }: FeedingPredictionCardProps) {
	const t = useTranslations("dashboard.growth.prediction");
	const [prediction, setPrediction] = useState<FeedingPrediction>(initialPrediction);
	const [isRefreshing, startRefresh] = useTransition();
	const [isApplying, startApply] = useTransition();
	const [applied, setApplied] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = () => {
		if (isRefreshing) return;
		setError(null);
		startRefresh(async () => {
			try {
				const data = await apiPost<FeedingPrediction>("/api/predict-feeding", undefined, {
					timeoutMs: 15_000,
				});
				setPrediction(data);
				setApplied(false);
			} catch {
				setError(t("refreshError"));
			}
		});
	};

	const apply = () => {
		const grams = prediction.grams;
		if (grams === null || isApplying) return;
		setError(null);
		startApply(async () => {
			const result = await applyPredictedGrams(deviceId, grams);
			if (result.success) {
				setApplied(true);
				setPrediction((p) => ({ ...p, currentGrams: grams }));
			} else {
				setError(result.error ?? t("applyError"));
			}
		});
	};

	const grams = prediction.grams;
	const current = prediction.currentGrams;
	const delta = grams !== null && current !== null && current > 0 ? grams - current : null;

	return (
		<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-700/60">
			<div className="flex items-start justify-between gap-4 mb-4">
				<div>
					<p className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
						<Brain className="h-4 w-4 text-[#0A3D62] dark:text-[#5b9bd5]" />
						{t("title")}
					</p>
					<p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("subtitle")}</p>
				</div>
				<button
					type="button"
					onClick={refresh}
					disabled={isRefreshing}
					aria-label={t("refresh")}
					className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
				>
					<RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
					{t("refresh")}
				</button>
			</div>

			{grams === null ? (
				<p className="text-sm text-gray-500 dark:text-gray-400 py-4">{t("noData")}</p>
			) : (
				<>
					<div className="flex flex-wrap items-end gap-4">
						<div>
							<p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
								{t("predictedLabel")}
							</p>
							<p className="text-4xl font-extrabold text-[var(--ofd-base-deep)] mt-1">
								{grams.toFixed(1)}{" "}
								<span className="text-lg text-gray-400 dark:text-gray-500 font-medium">g</span>
							</p>
						</div>
						{current !== null && (
							<div className="pb-1">
								<p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
									{t("currentLabel")}
								</p>
								<p className="text-lg font-bold text-gray-700 dark:text-gray-300 mt-0.5">
									{current.toFixed(1)}g
								</p>
							</div>
						)}
						{delta !== null && Math.abs(delta) >= 0.1 && (
							<span
								className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold mb-1 ${
									delta >= 0
										? "bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300"
										: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300"
								}`}
							>
								{delta >= 0 ? (
									<TrendingUp className="h-3.5 w-3.5" />
								) : (
									<TrendingDown className="h-3.5 w-3.5" />
								)}
								{delta >= 0 ? "+" : ""}
								{delta.toFixed(1)}g
							</span>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-2 mt-3">
						<span
							className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${confidenceClass[prediction.confidence]}`}
						>
							{t("confidence")}: {t(`confidence_${prediction.confidence}`)}
						</span>
						<span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2.5 py-1 text-[10px] font-black uppercase">
							{prediction.source === "ai" ? (
								<>
									<Sparkles className="h-3 w-3" /> {t("sourceAi")}
								</>
							) : (
								t("sourceFormula")
							)}
						</span>
					</div>

					<p className="text-sm text-gray-600 dark:text-gray-300 mt-3 leading-relaxed">
						{prediction.reasoning}
					</p>

					{error && (
						<p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
					)}

					<div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
						<button
							type="button"
							onClick={apply}
							disabled={isApplying || applied || (current !== null && grams === current)}
							className="flex items-center justify-center gap-2 rounded-xl bg-[#0A3D62] dark:bg-[#1f66a0] px-5 py-3 text-sm font-bold text-white hover:bg-[#164e7c] dark:hover:bg-[#164e7c] transition-colors disabled:opacity-50"
						>
							<Check className="h-4 w-4" />
							{applied ? t("applied") : isApplying ? t("applying") : t("apply")}
						</button>
						<p className="text-[11px] text-gray-400 dark:text-gray-500">{t("disclaimer")}</p>
					</div>
				</>
			)}
		</div>
	);
}
