"use client";

import { useRouter } from "@/i18n/routing";
import { type FeedCalculationResult, saveBiomassLog } from "@/lib/actions/biomass";
import { DEFAULT_FISH_COUNT } from "@/lib/constants";
import { dailyFeedG, feedPerMealG, totalBiomassG } from "@/lib/feed-calc";
import { enqueueBiomassSample, newClientEventId } from "@/lib/offline/outbox";
import { useOnlineStatus } from "@/lib/pwa/use-online-status";
import { AlertTriangle, CheckCircle2, Fish, Loader2, Plus, Ruler, Scale, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface LogSampleFormProps {
	pondId: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population?: number | null;
	canWrite?: boolean;
	batchLabels?: string[];
	scope?: string;
}

type InputMode = "average" | "individual";

interface IndividualFishEntry {
	id: string;
	weightGrams: string;
	lengthCm: string;
}

export function LogSampleForm({
	pondId,
	feedingRatePct,
	feedsPerDay,
	population = null,
	canWrite = true,
	batchLabels = [],
	scope = pondId,
}: LogSampleFormProps) {
	const tBtn = useTranslations("button");
	const tLog = useTranslations("dashboard.logSample");
	const router = useRouter();
	const online = useOnlineStatus();
	const [isPending, startTransition] = useTransition();
	const [queuedOffline, setQueuedOffline] = useState(false);

	const effectivePopulation = population && population > 0 ? population : DEFAULT_FISH_COUNT;
	const populationUnset = effectivePopulation !== population;
	const fmtG2 = (g: number) =>
		g.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	const [inputMode, setInputMode] = useState<InputMode>("average");
	const [batchLabel, setBatchLabel] = useState<string>("");
	const [feedResult, setFeedResult] = useState<FeedCalculationResult | null>(null);

	const [weightGrams, setWeightGrams] = useState<string>("");
	const [lengthCm, setLengthCm] = useState<string>("");
	const [count, setCount] = useState<string>("20");

	const [individualFish, setIndividualFish] = useState<IndividualFishEntry[]>([
		{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
		{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
	]);

	const [error, setError] = useState<string | null>(null);
	const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

	const w = Number.parseFloat(weightGrams);
	const l = Number.parseFloat(lengthCm);
	const c = Number.parseInt(count, 10);

	let biomassG = 0;
	let dailyFeed = 0;
	let nextFeedingG = 0;
	let avgWeightG = 0;
	let avgLengthCm = 0;
	let individualCount = 0;

	if (inputMode === "average") {
		if (!Number.isNaN(w) && !Number.isNaN(c) && c > 0) {
			avgWeightG = w;
			biomassG = totalBiomassG(population, w / 1000);
			dailyFeed = dailyFeedG(biomassG, feedingRatePct);
			nextFeedingG = feedPerMealG(biomassG, feedingRatePct, feedsPerDay);
		}
	} else {
		const validFish = individualFish.filter(
			(f) =>
				!Number.isNaN(Number.parseFloat(f.weightGrams)) && Number.parseFloat(f.weightGrams) > 0,
		);
		individualCount = validFish.length;
		if (individualCount > 0) {
			const totalWeight = validFish.reduce((sum, f) => sum + Number.parseFloat(f.weightGrams), 0);
			avgWeightG = totalWeight / individualCount;

			const validLengthFish = individualFish.filter(
				(f) => !Number.isNaN(Number.parseFloat(f.lengthCm)) && Number.parseFloat(f.lengthCm) > 0,
			);
			if (validLengthFish.length > 0) {
				const totalLength = validLengthFish.reduce(
					(sum, f) => sum + Number.parseFloat(f.lengthCm),
					0,
				);
				avgLengthCm = totalLength / validLengthFish.length;
			}

			biomassG = totalBiomassG(population, avgWeightG / 1000);
			dailyFeed = dailyFeedG(biomassG, feedingRatePct);
			nextFeedingG = feedPerMealG(biomassG, feedingRatePct, feedsPerDay);
		}
	}

	const addFishEntry = () => {
		setIndividualFish([
			...individualFish,
			{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
		]);
	};

	const removeFishEntry = (index: number) => {
		if (individualFish.length <= 1) return;
		setIndividualFish(individualFish.filter((_, i) => i !== index));
	};

	const updateFishEntry = (index: number, field: keyof IndividualFishEntry, value: string) => {
		const updated = [...individualFish];
		updated[index] = { ...updated[index], [field]: value };
		setIndividualFish(updated);
		if (rowErrors[index]) {
			const { [index]: _removed, ...rest } = rowErrors;
			setRowErrors(rest);
		}
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);
		setRowErrors({});

		let sampleWeightKg: number;
		let sampleLengthCm: number;
		let sampleCount: number;
		let fishSamplesData: Array<{ weightGrams: number; lengthCm: number }> = [];

		if (inputMode === "average") {
			if (Number.isNaN(w) || Number.isNaN(l) || Number.isNaN(c) || w <= 0 || l <= 0 || c <= 0) {
				setError("Please check measurements. All values must be greater than 0.");
				return;
			}
			sampleWeightKg = (w / 1000) * c;
			sampleLengthCm = l;
			sampleCount = c;
		} else {
			const errors: Record<number, string> = {};
			const validRows: Array<{ weightGrams: number; lengthCm: number }> = [];

			individualFish.forEach((fish, index) => {
				const weightRaw = fish.weightGrams.trim();
				const lengthRaw = fish.lengthCm.trim();
				if (weightRaw === "" && lengthRaw === "") return;

				const weightValue = Number.parseFloat(weightRaw);
				if (weightRaw === "" || Number.isNaN(weightValue) || weightValue <= 0) {
					errors[index] = "Weight must be greater than 0";
					return;
				}
				const lengthValue = lengthRaw === "" ? 0 : Number.parseFloat(lengthRaw);
				if (Number.isNaN(lengthValue) || lengthValue < 0) {
					errors[index] = "Length must be 0 or greater";
					return;
				}
				validRows.push({ weightGrams: weightValue, lengthCm: lengthValue });
			});

			if (Object.keys(errors).length > 0) {
				setRowErrors(errors);
				setError("Please fix the highlighted fish rows.");
				return;
			}
			if (validRows.length === 0) {
				setError("Please add at least one fish with a valid weight.");
				return;
			}

			fishSamplesData = validRows;

			const totalWeightG = fishSamplesData.reduce((sum, f) => sum + f.weightGrams, 0);
			sampleWeightKg = totalWeightG / 1000;

			const validLengthFish = fishSamplesData.filter((f) => f.lengthCm > 0);
			sampleLengthCm =
				validLengthFish.length > 0
					? validLengthFish.reduce((sum, f) => sum + f.lengthCm, 0) / validLengthFish.length
					: 0;

			sampleCount = validRows.length;
		}

		const formData = new FormData();
		formData.append("pondId", pondId);
		formData.append("sampleWeightKg", sampleWeightKg.toString());
		formData.append("sampleLengthCm", sampleLengthCm.toString());
		formData.append("sampleCount", sampleCount.toString());
		formData.append("batchLabel", batchLabel.trim());

		if (inputMode === "individual" && fishSamplesData.length > 0) {
			formData.append("fishSamples", JSON.stringify(fishSamplesData));
		}

		const offlinePayload = {
			clientEventId: newClientEventId(),
			pondId,
			scope,
			sampleCount,
			sampleWeightKg,
			sampleLengthCm,
			batchLabel: batchLabel.trim() || null,
			recordedAt: new Date().toISOString(),
			fishSamples: fishSamplesData.length > 0 ? fishSamplesData : undefined,
		};
		formData.append("clientEventId", offlinePayload.clientEventId);
		formData.append("recordedAt", offlinePayload.recordedAt);

		if (typeof navigator !== "undefined" && !navigator.onLine) {
			const queued = await enqueueBiomassSample(offlinePayload);
			if (!queued) {
				setError(tLog("queuedOfflineError"));
				return;
			}
			setQueuedOffline(true);
			return;
		}

		startTransition(async () => {
			try {
				const result = await saveBiomassLog(formData);
				if (!result.success) {
					setError(result.error);
					return;
				}
				setFeedResult(result.feed);
			} catch {
				const queued = await enqueueBiomassSample(offlinePayload);
				if (queued) {
					setQueuedOffline(true);
				} else {
					setError("Failed to save biomass log. Please try again.");
				}
			}
		});
	};

	const resetForAnother = () => {
		setFeedResult(null);
		setQueuedOffline(false);
		setError(null);
		setRowErrors({});
		setBatchLabel("");
		setWeightGrams("");
		setLengthCm("");
		setCount("20");
		setInputMode("average");
		setIndividualFish([
			{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
			{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
		]);
	};

	const fieldCls =
		"w-full pl-10 pr-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E85A2A] font-bold text-lg transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500";

	const fishFieldCls =
		"w-full pl-8 pr-3 py-2.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E85A2A] font-bold text-sm transition-colors dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500";

	if (queuedOffline) {
		return (
			<div className="space-y-6 py-4 text-center">
				<div className="flex justify-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/15">
						<CheckCircle2 className="h-8 w-8 text-blue-600 dark:text-blue-300" />
					</div>
				</div>
				<div>
					<h3 className="text-xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
						{tLog("queuedOfflineTitle")}
					</h3>
					<p className="mx-auto mt-1 max-w-md text-sm text-gray-600 dark:text-gray-400">
						{tLog("queuedOfflineBody")}
					</p>
				</div>
				<button
					type="button"
					onClick={resetForAnother}
					className="rounded-xl bg-[var(--ofd-base)] px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
				>
					Log Another Sample
				</button>
			</div>
		);
	}

	if (feedResult) {
		const headlineGrams = feedResult.calculatedGrams ?? feedResult.effectiveGrams;
		const statusInfo: Record<FeedCalculationResult["status"], { text: string; cls: string }> = {
			updated: {
				text: `Device schedule updated: ${feedResult.previousGrams ?? "—"}g → ${feedResult.effectiveGrams}g per feeding.`,
				cls: "border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
			},
			unchanged: {
				text: `Device schedule already at ${feedResult.effectiveGrams}g per feeding — unchanged.`,
				cls: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
			},
			rejected_deviation: {
				text: `Schedule kept at ${feedResult.previousGrams}g — the calculated ${feedResult.calculatedGrams}g differs by more than 50% from the current amount. Review it before applying.`,
				cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
			},
			rejected_out_of_range: {
				text: `Schedule kept at ${feedResult.previousGrams}g — the calculated ${feedResult.calculatedGrams}g is outside the allowed range.`,
				cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
			},
			skipped_config: {
				text: "Device schedule unchanged — set the pond feeding rate and feeds per day first.",
				cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
			},
			skipped_no_device: {
				text: "Device schedule unchanged — no device is linked to this pond.",
				cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
			},
			skipped_no_population: {
				text: "Device schedule unchanged — set the pond fish population so biomass can be computed.",
				cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
			},
			skipped_target_plan: {
				text: "Sample saved. The target growth plan is not due for another adjustment — open Growth to review the next date.",
				cls: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
			},
		};
		const status = statusInfo[feedResult.status];

		return (
			<div className="space-y-6 py-4 text-center">
				<div className="flex justify-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/15">
						<CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-300" />
					</div>
				</div>

				<div>
					<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400">
						Feed to dispense per feeding
					</p>
					<p className="mt-1 text-5xl font-black text-[#E85A2A]">
						{headlineGrams !== null ? headlineGrams.toFixed(2) : "—"}
						<span className="text-2xl"> g</span>
					</p>
					{feedResult.dailyFeedG !== null && (
						<p className="mt-1 text-sm font-medium text-[#3D5568] dark:text-gray-400">
							Daily total {feedResult.dailyFeedG.toFixed(2)}g · {feedResult.feedsPerDay} feed
							{feedResult.feedsPerDay === 1 ? "" : "s"} per day
						</p>
					)}
					<p className="mt-2 text-sm text-[#3D5568] dark:text-gray-400">
						Saved to{" "}
						<strong className="text-[#0A3D62] dark:text-gray-100">
							{feedResult.batchLabel || "Unlabeled"}
						</strong>
						{feedResult.batchLabel ? "" : " (no sampling batch)"}
					</p>
				</div>

				<div className={`rounded-xl border p-4 text-sm font-medium text-left ${status.cls}`}>
					{status.text}
					{feedResult.deviceOffline && (
						<span className="mt-1.5 block font-normal">
							<AlertTriangle className="mr-1 inline h-3.5 w-3.5 -mt-0.5" />
							Device is offline — the new schedule applies once it reconnects.
						</span>
					)}
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
					<button
						type="button"
						onClick={resetForAnother}
						className="bg-[#E85A2A] text-white px-8 py-3.5 rounded-2xl font-black shadow-lg hover:bg-[#d04a1f] transition-all"
					>
						Log Another Sample
					</button>
					<button
						type="button"
						onClick={() => router.push("/dashboard")}
						className="border border-[#0A3D62] text-[#0A3D62] px-8 py-3.5 rounded-2xl font-black hover:bg-[#0A3D62]/5 transition-all dark:border-[#5b9bd5] dark:text-[#5b9bd5] dark:hover:bg-white/5"
					>
						Back to Dashboard
					</button>
				</div>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{error && (
				<div className="p-4 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
					{error}
				</div>
			)}

			<div className="flex gap-2 p-1 bg-[#F4F7F6] rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
				<button
					type="button"
					onClick={() => setInputMode("average")}
					className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all ${
						inputMode === "average"
							? "bg-[#0A3D62] text-white shadow-md dark:bg-[#1f66a0]"
							: "text-[#3D5568] hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-100"
					}`}
				>
					<Scale className="inline-block w-4 h-4 mr-1.5 -mt-0.5" />
					Average Mode
				</button>
				<button
					type="button"
					onClick={() => setInputMode("individual")}
					className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all ${
						inputMode === "individual"
							? "bg-[#0A3D62] text-white shadow-md dark:bg-[#1f66a0]"
							: "text-[#3D5568] hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-100"
					}`}
				>
					<Fish className="inline-block w-4 h-4 mr-1.5 -mt-0.5" />
					Individual Mode
				</button>
			</div>

			<div className="space-y-1.5">
				<label
					htmlFor="batchLabel"
					className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400"
				>
					Sampling batch (optional)
				</label>
				<div className="relative">
					<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
						<Fish className="h-5 w-5" />
					</div>
					<input
						type="text"
						id="batchLabel"
						maxLength={64}
						list="batchLabelOptions"
						className={fieldCls}
						placeholder="e.g. Sampling batch 2026-10 A"
						value={batchLabel}
						onChange={(e) => setBatchLabel(e.target.value)}
					/>
					<datalist id="batchLabelOptions">
						{batchLabels.map((label) => (
							<option key={label} value={label} />
						))}
					</datalist>
				</div>
			</div>

			{inputMode === "average" ? (
				<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
					<div className="space-y-1.5">
						<label
							htmlFor="weightGrams"
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400"
						>
							Avg. Fish Weight (grams)
						</label>
						<div className="relative">
							<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
								<Scale className="h-5 w-5" />
							</div>
							<input
								type="number"
								step="0.1"
								id="weightGrams"
								required
								min="0.1"
								className={fieldCls}
								placeholder="e.g. 220"
								value={weightGrams}
								onChange={(e) => setWeightGrams(e.target.value)}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="lengthCm"
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400"
						>
							Avg. Fish Length (cm)
						</label>
						<div className="relative">
							<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
								<Ruler className="h-5 w-5" />
							</div>
							<input
								type="number"
								step="0.1"
								id="lengthCm"
								required
								min="0.1"
								className={fieldCls}
								placeholder="e.g. 24"
								value={lengthCm}
								onChange={(e) => setLengthCm(e.target.value)}
							/>
						</div>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="sampleCount"
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400"
						>
							Sample Fish Count
						</label>
						<div className="relative">
							<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
								<Fish className="h-5 w-5" />
							</div>
							<input
								type="number"
								id="sampleCount"
								required
								min="1"
								className={fieldCls}
								value={count}
								onChange={(e) => setCount(e.target.value)}
							/>
						</div>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568] dark:text-gray-400">
							Individual Fish Measurements
						</p>
						<button
							type="button"
							onClick={addFishEntry}
							className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E85A2A] text-white text-xs font-bold rounded-lg hover:bg-[#d04a1f] transition-colors"
						>
							<Plus className="w-3.5 h-3.5" />
							Add Fish
						</button>
					</div>

					<div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
						{individualFish.map((fish, index) => (
							<div
								key={fish.id}
								className="p-3 bg-[#F4F7F6] rounded-xl border border-gray-200 dark:border-gray-700 dark:bg-gray-800/60"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-xs font-bold text-[#3D5568] dark:text-gray-400 w-6 text-center shrink-0">
										#{index + 1}
									</span>
									<div className="flex-1 min-w-[7.5rem] relative">
										<div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
											<Scale className="h-3.5 w-3.5" />
										</div>
										<input
											type="number"
											step="0.1"
											min="0.1"
											placeholder="Weight (g)"
											className={fishFieldCls}
											value={fish.weightGrams}
											onChange={(e) => updateFishEntry(index, "weightGrams", e.target.value)}
										/>
									</div>
									<div className="flex-1 min-w-[7.5rem] relative">
										<div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
											<Ruler className="h-3.5 w-3.5" />
										</div>
										<input
											type="number"
											step="0.1"
											min="0"
											placeholder="Length (cm)"
											className={fishFieldCls}
											value={fish.lengthCm}
											onChange={(e) => updateFishEntry(index, "lengthCm", e.target.value)}
										/>
									</div>
									<button
										type="button"
										onClick={() => removeFishEntry(index)}
										disabled={individualFish.length <= 1}
										className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0 ml-auto sm:ml-0"
									>
										<X className="w-4 h-4" />
									</button>
								</div>
								{rowErrors[index] && (
									<p className="mt-1.5 pl-8 text-xs font-bold text-red-500 dark:text-red-400">
										{rowErrors[index]}
									</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			<div className="bg-[#0A3D62]/5 border border-[#0A3D62]/10 rounded-2xl p-6 dark:border-white/10 dark:bg-white/5">
				<h3 className="text-sm font-black text-[#0A3D62] dark:text-[#5b9bd5] mb-1">Live Preview</h3>
				<p className="text-[#3D5568] dark:text-gray-400 text-xs leading-relaxed">
					{inputMode === "individual" && (
						<>
							Sampled{" "}
							<strong className="text-[#0A3D62] dark:text-gray-100">{individualCount}</strong>{" "}
							fish(s).
							<br />
						</>
					)}
					Calculated Average Body Weight (ABW):{" "}
					<strong className="text-[#0A3D62] dark:text-gray-100">
						{avgWeightG > 0 ? avgWeightG.toFixed(1) : "—"}g
					</strong>
					.
					{avgLengthCm > 0 && (
						<>
							<br />
							Average Length:{" "}
							<strong className="text-[#0A3D62] dark:text-gray-100">
								{avgLengthCm.toFixed(1)}cm
							</strong>
						</>
					)}
				</p>

				<div className="mt-3 space-y-1.5 border-t border-[#0A3D62]/10 pt-3 text-xs dark:border-gray-700/50">
					<div className="flex items-baseline justify-between gap-4">
						<span className="font-medium text-[#3D5568] dark:text-gray-400">
							Total Biomass
							{biomassG === 0 && (
								<span className="block text-[11px] font-normal text-[#3D5568]/60 dark:text-gray-500">
									= {populationUnset ? "estimate assuming " : ""}
									{effectivePopulation.toLocaleString("en-US")} fish × avg weight
								</span>
							)}
						</span>
						<span className="text-right text-[#3D5568] dark:text-gray-400">
							<strong className="text-[#0A3D62] dark:text-gray-100">
								{biomassG > 0 ? Math.round(biomassG).toLocaleString("en-US") : "—"}
							</strong>
							{biomassG > 0 && (
								<>
									g{" "}
									<span>
										({populationUnset ? "estimate: " : ""}
										{effectivePopulation.toLocaleString("en-US")} fish × {avgWeightG.toFixed(1)}g)
									</span>
								</>
							)}
						</span>
					</div>
					<div className="flex items-baseline justify-between gap-4">
						<span className="font-medium text-[#3D5568] dark:text-gray-400">
							Daily Feed
							{dailyFeed === 0 && (
								<span className="block text-[11px] font-normal text-[#3D5568]/60 dark:text-gray-500">
									= biomass × {feedingRatePct}%
								</span>
							)}
						</span>
						<span className="text-right text-[#3D5568] dark:text-gray-400">
							<strong className="text-[#0A3D62] dark:text-gray-100">
								{dailyFeed > 0 ? fmtG2(dailyFeed) : "—"}
							</strong>
							{dailyFeed > 0 && (
								<>
									g{" "}
									<span>
										({Math.round(biomassG).toLocaleString("en-US")}g × {feedingRatePct}%)
									</span>
								</>
							)}
						</span>
					</div>
					<div className="flex items-baseline justify-between gap-4">
						<span className="font-medium text-[#3D5568] dark:text-gray-400">
							Feed per Meal
							{nextFeedingG === 0 && (
								<span className="block text-[11px] font-normal text-[#3D5568]/60 dark:text-gray-500">
									= daily ÷ {feedsPerDay} feeds
								</span>
							)}
						</span>
						<span className="text-right text-[#3D5568] dark:text-gray-400">
							<strong className="text-sm text-[#E85A2A]">
								{nextFeedingG > 0 ? fmtG2(nextFeedingG) : "—"}
							</strong>
							{nextFeedingG > 0 && (
								<>
									g <span>(÷ {feedsPerDay} feeds)</span>
								</>
							)}
						</span>
					</div>
				</div>
			</div>

			{!online && (
				<p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
					{tLog("offlineNote")}
				</p>
			)}

			<div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-700/50">
				<button
					type="submit"
					disabled={isPending || avgWeightG === 0 || !canWrite}
					className="w-full md:w-auto bg-[#E85A2A] text-white px-8 py-3.5 rounded-2xl font-black shadow-lg hover:bg-[#d04a1f] hover:shadow-xl transition-all transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex justify-center items-center gap-2"
				>
					{isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : tBtn("saveSample")}
				</button>
			</div>
		</form>
	);
}
