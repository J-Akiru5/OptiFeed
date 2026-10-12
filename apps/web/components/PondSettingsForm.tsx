"use client";

import { updatePondSettings } from "@/lib/actions/settings";
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
	};
}

export function PondSettingsForm({ pond }: PondSettingsFormProps) {
	const t = useTranslations("dashboard.settings");
	const [feedingRate, setFeedingRate] = useState(pond.feedingRatePct.toString());
	const [feedsPerDay, setFeedsPerDay] = useState(pond.feedsPerDay.toString());
	const [sampleInterval, setSampleInterval] = useState(pond.sampleIntervalDays.toString());
	const [population, setPopulation] = useState(pond.population?.toString() ?? "");
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

		if (Number.isNaN(rate) || Number.isNaN(feeds) || Number.isNaN(interval)) return;
		if (pop !== null && (Number.isNaN(pop) || pop < 0)) return;

		startTransition(async () => {
			const result = await updatePondSettings(pond.id, rate, feeds, interval, pop);
			if (result.success) {
				setSuccess(true);
				setTimeout(() => setSuccess(false), 3000);
			} else {
				setError(result.error ?? "Failed to save settings");
			}
		});
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="mt-6 flex flex-col gap-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
		>
			<h2 className="text-xl font-semibold text-gray-800">{t("configTitle")}</h2>

			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
				<div className="flex flex-col gap-2">
					<label htmlFor="feedingRate" className="text-sm font-medium text-gray-700">
						{t("rateLabel")}
					</label>
					<input
						id="feedingRate"
						type="number"
						step="0.1"
						min="0"
						value={feedingRate}
						onChange={(e) => setFeedingRate(e.target.value)}
						className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
						required
					/>
					<p className="text-xs text-gray-500">{t("rateDesc")}</p>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="feedsPerDay" className="text-sm font-medium text-gray-700">
						{t("freqLabel")}
					</label>
					<input
						id="feedsPerDay"
						type="number"
						min="1"
						max="24"
						value={feedsPerDay}
						onChange={(e) => setFeedsPerDay(e.target.value)}
						className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
						required
					/>
					<p className="text-xs text-gray-500">{t("freqDesc")}</p>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="sampleInterval" className="text-sm font-medium text-gray-700">
						Sample Interval (days)
					</label>
					<input
						id="sampleInterval"
						type="number"
						min="1"
						max="90"
						value={sampleInterval}
						onChange={(e) => setSampleInterval(e.target.value)}
						className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
						required
					/>
					<p className="text-xs text-gray-500">
						How often fish samples are taken (e.g. 15 or 30 days)
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<label htmlFor="population" className="text-sm font-medium text-gray-700">
						Population (fish)
					</label>
					<input
						id="population"
						type="number"
						min="0"
						value={population}
						onChange={(e) => setPopulation(e.target.value)}
						placeholder="e.g. 200"
						className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
					/>
					<p className="text-xs text-gray-500">
						Number of fish — used for total biomass and daily feed
					</p>
				</div>
			</div>

			<div className="flex items-center gap-4">
				<button
					type="submit"
					disabled={isPending}
					className="flex min-h-[var(--ofd-touch-min)] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{isPending ? <Loader2 size={18} className="animate-spin" /> : t("saveSettings")}
				</button>
				{success && (
					<span className="flex items-center gap-1 text-sm font-medium text-green-600 animate-in fade-in">
						<CheckCircle2 size={18} />
						{t("success")}
					</span>
				)}
				{error && (
					<span className="flex items-center gap-1 text-sm font-medium text-red-600">
						<XCircle size={18} />
						{error}
					</span>
				)}
			</div>
		</form>
	);
}
