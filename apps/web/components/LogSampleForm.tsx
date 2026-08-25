"use client";

import { useRouter } from "@/i18n/routing";
import { saveBiomassLog } from "@/lib/actions/biomass";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { Fish, Loader2, Plus, Ruler, Scale, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface LogSampleFormProps {
	pondId: string;
	feedingRatePct: number;
	feedsPerDay: number;
}

type InputMode = "average" | "individual";

interface IndividualFishEntry {
	id: string;
	weightGrams: string;
	lengthCm: string;
}

export function LogSampleForm({ pondId, feedingRatePct, feedsPerDay }: LogSampleFormProps) {
	const tBtn = useTranslations("button");
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const [inputMode, setInputMode] = useState<InputMode>("average");

	const [weightGrams, setWeightGrams] = useState<string>("");
	const [lengthCm, setLengthCm] = useState<string>("");
	const [count, setCount] = useState<string>("20");

	const [individualFish, setIndividualFish] = useState<IndividualFishEntry[]>([
		{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
		{ weightGrams: "", lengthCm: "", id: crypto.randomUUID() },
	]);

	const [error, setError] = useState<string | null>(null);

	const w = Number.parseFloat(weightGrams);
	const l = Number.parseFloat(lengthCm);
	const c = Number.parseInt(count, 10);

	let nextFeedingG = 0;
	let avgWeightG = 0;
	let avgLengthCm = 0;
	let individualCount = 0;

	if (inputMode === "average") {
		if (!Number.isNaN(w) && !Number.isNaN(c) && c > 0) {
			avgWeightG = w;
			nextFeedingG = calculateNextFeeding(w / 1000, feedingRatePct, feedsPerDay);
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

			nextFeedingG = calculateNextFeeding(avgWeightG / 1000, feedingRatePct, feedsPerDay);
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
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);

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
			const validFish = individualFish.filter(
				(f) =>
					!Number.isNaN(Number.parseFloat(f.weightGrams)) && Number.parseFloat(f.weightGrams) > 0,
			);
			if (validFish.length === 0) {
				setError("Please add at least one fish with a valid weight.");
				return;
			}

			fishSamplesData = validFish.map((f) => ({
				weightGrams: Number.parseFloat(f.weightGrams),
				lengthCm: Number.parseFloat(f.lengthCm) || 0,
			}));

			const totalWeightG = fishSamplesData.reduce((sum, f) => sum + f.weightGrams, 0);
			sampleWeightKg = totalWeightG / 1000;

			const validLengthFish = fishSamplesData.filter((f) => f.lengthCm > 0);
			sampleLengthCm =
				validLengthFish.length > 0
					? validLengthFish.reduce((sum, f) => sum + f.lengthCm, 0) / validLengthFish.length
					: 0;

			sampleCount = validFish.length;
		}

		const formData = new FormData();
		formData.append("pondId", pondId);
		formData.append("sampleWeightKg", sampleWeightKg.toString());
		formData.append("sampleLengthCm", sampleLengthCm.toString());
		formData.append("sampleCount", sampleCount.toString());

		if (inputMode === "individual" && fishSamplesData.length > 0) {
			formData.append("fishSamples", JSON.stringify(fishSamplesData));
		}

		startTransition(async () => {
			try {
				await saveBiomassLog(formData);
				router.push("/dashboard");
			} catch (err) {
				setError("Failed to save biomass log. Please check your inputs.");
			}
		});
	};

	const fieldCls =
		"w-full pl-10 pr-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E85A2A] font-bold text-lg transition-colors";

	const fishFieldCls =
		"w-full px-3 py-2.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#E85A2A] font-bold text-sm transition-colors";

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{error && (
				<div className="p-4 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium">
					{error}
				</div>
			)}

			<div className="flex gap-2 p-1 bg-[#F4F7F6] rounded-xl border border-gray-200">
				<button
					type="button"
					onClick={() => setInputMode("average")}
					className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all ${
						inputMode === "average"
							? "bg-[#0A3D62] text-white shadow-md"
							: "text-[#3D5568] hover:text-[#0A3D62]"
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
							? "bg-[#0A3D62] text-white shadow-md"
							: "text-[#3D5568] hover:text-[#0A3D62]"
					}`}
				>
					<Fish className="inline-block w-4 h-4 mr-1.5 -mt-0.5" />
					Individual Mode
				</button>
			</div>

			{inputMode === "average" ? (
				<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
					<div className="space-y-1.5">
						<label
							htmlFor="weightGrams"
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
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
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
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
							className="block text-xs uppercase font-extrabold tracking-wider text-[#3D5568]"
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
						<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
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
								className="flex items-center gap-2 p-3 bg-[#F4F7F6] rounded-xl border border-gray-200"
							>
								<span className="text-xs font-bold text-[#3D5568] w-6 text-center shrink-0">
									#{index + 1}
								</span>
								<div className="flex-1 relative">
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
								<div className="flex-1 relative">
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
									className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
								>
									<X className="w-4 h-4" />
								</button>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="bg-[#0A3D62]/5 border border-[#0A3D62]/10 rounded-2xl p-6">
				<h3 className="text-sm font-black text-[#0A3D62] mb-1">Live Preview</h3>
				<p className="text-[#3D5568] text-xs leading-relaxed">
					{inputMode === "individual" && (
						<>
							Sampled <strong className="text-[#0A3D62]">{individualCount}</strong> fish(s).
							<br />
						</>
					)}
					Calculated Average Body Weight (ABW):{" "}
					<strong className="text-[#0A3D62]">
						{avgWeightG > 0 ? avgWeightG.toFixed(1) : "—"}g
					</strong>
					.
					{avgLengthCm > 0 && (
						<>
							<br />
							Average Length: <strong className="text-[#0A3D62]">{avgLengthCm.toFixed(1)}cm</strong>
						</>
					)}
					<br />
					Assuming 5,000 fish at a {feedingRatePct}% daily feeding rate across {feedsPerDay} feeds,
					this sample will set your next scheduled feeding to approximately{" "}
					<strong className="text-[#E85A2A] text-sm">
						{nextFeedingG > 0 ? nextFeedingG : "—"}g
					</strong>
					.
				</p>
			</div>

			<div className="flex justify-end pt-4 border-t border-gray-100">
				<button
					type="submit"
					disabled={isPending || avgWeightG === 0}
					className="w-full md:w-auto bg-[#E85A2A] text-white px-8 py-3.5 rounded-2xl font-black shadow-lg hover:bg-[#d04a1f] hover:shadow-xl transition-all transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex justify-center items-center gap-2"
				>
					{isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : tBtn("saveSample")}
				</button>
			</div>
		</form>
	);
}
