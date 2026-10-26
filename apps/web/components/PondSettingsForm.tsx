"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { updatePondSettings } from "@/lib/actions/settings";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface PondSettingsFormProps {
	pond: {
		id: string;
		feedingRatePct: number;
		feedsPerDay: number;
		sampleIntervalDays: number;
		population: number | null;
		areaM2: number | null;
		averageDepthM: number | null;
		feedPricePerKg: number | null;
	};
	canWrite?: boolean;
}

export function PondSettingsForm({ pond, canWrite = true }: PondSettingsFormProps) {
	const t = useTranslations("dashboard.settings");
	const [feedingRate, setFeedingRate] = useState(pond.feedingRatePct.toString());
	const [feedsPerDay, setFeedsPerDay] = useState(pond.feedsPerDay.toString());
	const [sampleInterval, setSampleInterval] = useState(pond.sampleIntervalDays.toString());
	const [population, setPopulation] = useState(pond.population?.toString() ?? "");
	const [areaM2, setAreaM2] = useState(pond.areaM2?.toString() ?? "");
	const [averageDepthM, setAverageDepthM] = useState(pond.averageDepthM?.toString() ?? "");
	const [feedPricePerKg, setFeedPricePerKg] = useState(pond.feedPricePerKg?.toString() ?? "");
	const [isPending, startTransition] = useTransition();
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setSuccess(false);
		setError(null);

		const rate = Number.parseFloat(feedingRate);
		const feeds = Number.parseInt(feedsPerDay, 10);
		const interval = Number.parseInt(sampleInterval, 10);
		const pop = population.trim() === "" ? null : Number.parseInt(population, 10);
		const area = areaM2.trim() === "" ? null : Number.parseFloat(areaM2);
		const depth = averageDepthM.trim() === "" ? null : Number.parseFloat(averageDepthM);
		const price = feedPricePerKg.trim() === "" ? null : Number.parseFloat(feedPricePerKg);

		if (Number.isNaN(rate) || Number.isNaN(feeds) || Number.isNaN(interval)) return;
		if (pop !== null && (Number.isNaN(pop) || pop < 0)) return;
		if (
			(area !== null && (Number.isNaN(area) || area <= 0)) ||
			(depth !== null && (Number.isNaN(depth) || depth <= 0)) ||
			(price !== null && (Number.isNaN(price) || price < 0))
		) {
			setError(t("invalidPondProfile"));
			return;
		}

		startTransition(async () => {
			const result = await updatePondSettings(pond.id, rate, feeds, interval, pop, {
				areaM2: area,
				averageDepthM: depth,
				feedPricePerKg: price,
			});
			if (result.success) {
				setSuccess(true);
				setTimeout(() => setSuccess(false), 3000);
			} else {
				setError(result.error ?? t("saveError"));
			}
		});
	};

	const populationNumber = Number.parseInt(population, 10);
	const areaNumber = Number.parseFloat(areaM2);
	const density =
		Number.isFinite(populationNumber) &&
		populationNumber > 0 &&
		Number.isFinite(areaNumber) &&
		areaNumber > 0
			? populationNumber / areaNumber
			: null;

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-6">
			<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
				<div>
					<label htmlFor="feedingRate" className={dashboardLabel}>
						{t("rateLabel")}
					</label>
					<input
						id="feedingRate"
						type="number"
						step="0.1"
						min="0"
						inputMode="decimal"
						value={feedingRate}
						onChange={(e) => setFeedingRate(e.target.value)}
						disabled={!canWrite}
						className={dashboardField}
						required
					/>
					<span className={dashboardHint}>{t("rateDesc")}</span>
				</div>

				<div>
					<label htmlFor="feedsPerDay" className={dashboardLabel}>
						{t("freqLabel")}
					</label>
					<input
						id="feedsPerDay"
						type="number"
						min="1"
						max="24"
						inputMode="numeric"
						value={feedsPerDay}
						onChange={(e) => setFeedsPerDay(e.target.value)}
						disabled={!canWrite}
						className={dashboardField}
						required
					/>
					<span className={dashboardHint}>{t("freqDesc")}</span>
				</div>

				<div>
					<label htmlFor="sampleInterval" className={dashboardLabel}>
						{t("sampleIntervalLabel")}
					</label>
					<input
						id="sampleInterval"
						type="number"
						min="1"
						max="90"
						inputMode="numeric"
						value={sampleInterval}
						onChange={(e) => setSampleInterval(e.target.value)}
						disabled={!canWrite}
						className={dashboardField}
						required
					/>
					<span className={dashboardHint}>{t("sampleIntervalDesc")}</span>
				</div>

				<div>
					<label htmlFor="population" className={dashboardLabel}>
						{t("populationLabel")}
					</label>
					<input
						id="population"
						type="number"
						min="0"
						inputMode="numeric"
						value={population}
						onChange={(e) => setPopulation(e.target.value)}
						placeholder={t("populationPlaceholder")}
						disabled={!canWrite}
						className={dashboardField}
					/>
					<span className={dashboardHint}>{t("populationDesc")}</span>
				</div>

				<div>
					<label htmlFor="areaM2" className={dashboardLabel}>
						{t("areaLabel")}
					</label>
					<input
						id="areaM2"
						type="number"
						min="0"
						step="0.1"
						inputMode="decimal"
						value={areaM2}
						onChange={(e) => setAreaM2(e.target.value)}
						placeholder={t("areaPlaceholder")}
						disabled={!canWrite}
						className={dashboardField}
					/>
					<span className={dashboardHint}>{t("areaDesc")}</span>
				</div>

				<div>
					<label htmlFor="averageDepthM" className={dashboardLabel}>
						{t("depthLabel")}
					</label>
					<input
						id="averageDepthM"
						type="number"
						min="0"
						step="0.1"
						inputMode="decimal"
						value={averageDepthM}
						onChange={(e) => setAverageDepthM(e.target.value)}
						placeholder={t("depthPlaceholder")}
						disabled={!canWrite}
						className={dashboardField}
					/>
					<span className={dashboardHint}>{t("depthDesc")}</span>
				</div>

				<div>
					<label htmlFor="feedPricePerKg" className={dashboardLabel}>
						{t("feedPriceLabel")}
					</label>
					<input
						id="feedPricePerKg"
						type="number"
						min="0"
						step="0.01"
						inputMode="decimal"
						value={feedPricePerKg}
						onChange={(e) => setFeedPricePerKg(e.target.value)}
						placeholder={t("feedPricePlaceholder")}
						disabled={!canWrite}
						className={dashboardField}
					/>
					<span className={dashboardHint}>{t("feedPriceDesc")}</span>
				</div>

				<div>
					<p className={dashboardLabel}>{t("densityLabel")}</p>
					<p className="flex min-h-11 items-center rounded-xl bg-[#F4F7F6] px-4 py-2 text-sm font-black text-[#0A3D62] dark:bg-gray-800 dark:text-gray-100">
						{density !== null
							? t("densityValue", { density: density.toFixed(1) })
							: t("densityNoArea")}
					</p>
				</div>
			</div>

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<button
					type="submit"
					disabled={isPending || !canWrite}
					className={cn(dashboardButtonPrimary, "sm:min-w-[140px]")}
				>
					{isPending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
					{isPending ? t("saving") : t("saveSettings")}
				</button>
				{success && (
					<output className="flex items-center gap-1 text-sm font-bold text-[#1E7B34] dark:text-green-300">
						<CheckCircle2 size={18} aria-hidden="true" />
						{t("success")}
					</output>
				)}
				{error && (
					<span
						role="alert"
						className="flex items-center gap-1 text-sm font-bold text-[#C42B3A] dark:text-red-300"
					>
						<XCircle size={18} aria-hidden="true" />
						{error}
					</span>
				)}
			</div>
		</form>
	);
}
