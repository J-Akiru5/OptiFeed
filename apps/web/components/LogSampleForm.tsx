"use client";

import { useRouter } from "@/i18n/routing";
import { saveBiomassLog } from "@/lib/actions/biomass";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { Fish, Loader2, Ruler, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

interface LogSampleFormProps {
	pondId: string;
	feedingRatePct: number;
	feedsPerDay: number;
}

export function LogSampleForm({ pondId, feedingRatePct, feedsPerDay }: LogSampleFormProps) {
	const tBtn = useTranslations("button");
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const [weightGrams, setWeightGrams] = useState<string>("");
	const [lengthCm, setLengthCm] = useState<string>("");
	const [count, setCount] = useState<string>("20");
	const [error, setError] = useState<string | null>(null);

	const w = Number.parseFloat(weightGrams);
	const l = Number.parseFloat(lengthCm);
	const c = Number.parseInt(count, 10);

	let nextFeedingG = 0;
	let avgWeightG = 0;

	if (!Number.isNaN(w) && !Number.isNaN(c) && c > 0) {
		avgWeightG = w;
		const avgWeightKg = avgWeightG / 1000;
		// Based on prototype formula: (AvgWeight * Population * (Rate/100)) / FeedsPerDay
		const pondPopulation = 5000;
		const totalBiomassGrams = avgWeightG * pondPopulation;
		const dailyFeedGrams = totalBiomassGrams * (feedingRatePct / 100);
		nextFeedingG = Math.round(dailyFeedGrams / feedsPerDay);
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);

		if (Number.isNaN(w) || Number.isNaN(l) || Number.isNaN(c) || w <= 0 || l <= 0 || c <= 0) {
			setError("Please check measurements. All values must be greater than 0.");
			return;
		}

		// Calculate total weight to match DB schema requirements
		const avgWeightKg = w / 1000;
		const totalWeightKg = avgWeightKg * c;

		const formData = new FormData();
		formData.append("pondId", pondId);
		formData.append("sampleWeightKg", totalWeightKg.toString());
		formData.append("sampleLengthCm", l.toString());
		formData.append("sampleCount", c.toString());

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

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{error && (
				<div className="p-4 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium">
					{error}
				</div>
			)}

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

			<div className="bg-[#0A3D62]/5 border border-[#0A3D62]/10 rounded-2xl p-6">
				<h3 className="text-sm font-black text-[#0A3D62] mb-1">Live Preview</h3>
				<p className="text-[#3D5568] text-xs leading-relaxed">
					Calculated Average Body Weight (ABW):{" "}
					<strong className="text-[#0A3D62]">
						{avgWeightG > 0 ? avgWeightG.toFixed(1) : "—"}g
					</strong>
					.
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
