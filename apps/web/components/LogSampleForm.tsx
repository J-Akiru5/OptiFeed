"use client";

import { saveBiomassLog } from "@/lib/actions/biomass";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { Fish, Loader2, Ruler, Scale } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface LogSampleFormProps {
	pondId: string;
	feedingRatePct: number;
	feedsPerDay: number;
}

export function LogSampleForm({ pondId, feedingRatePct, feedsPerDay }: LogSampleFormProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const [weightKg, setWeightKg] = useState<string>("");
	const [lengthCm, setLengthCm] = useState<string>("");
	const [count, setCount] = useState<string>("50");
	const [error, setError] = useState<string | null>(null);

	const w = Number.parseFloat(weightKg);
	const c = Number.parseInt(count, 10);
	let nextFeedingG = 0;
	let avgWeightG = 0;

	if (!Number.isNaN(w) && !Number.isNaN(c) && c > 0) {
		const avgWeightKg = w / c;
		avgWeightG = avgWeightKg * 1000;
		nextFeedingG = calculateNextFeeding(avgWeightKg, feedingRatePct, feedsPerDay, 5000);
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);

		const formData = new FormData(e.currentTarget);
		formData.append("pondId", pondId);

		startTransition(async () => {
			try {
				await saveBiomassLog(formData);
				router.push("/en/dashboard");
			} catch (err) {
				setError("Failed to save biomass log. Please check your inputs.");
			}
		});
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
			{error && (
				<div className="p-4 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium">
					{error}
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div className="space-y-2">
					<label htmlFor="sampleWeightKg" className="block text-sm font-semibold text-gray-700">
						Total Sample Weight (kg)
					</label>
					<div className="relative">
						<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
							<Scale className="h-5 w-5" />
						</div>
						<input
							type="number"
							step="0.01"
							id="sampleWeightKg"
							name="sampleWeightKg"
							required
							min="0.01"
							className="pl-10 block w-full rounded-xl border-gray-300 shadow-sm focus:border-[var(--ofd-action)] focus:ring-[var(--ofd-action)] sm:text-sm bg-gray-50 p-3 outline-none border transition-colors"
							placeholder="e.g. 1.25"
							value={weightKg}
							onChange={(e) => setWeightKg(e.target.value)}
						/>
					</div>
				</div>

				<div className="space-y-2">
					<label htmlFor="sampleCount" className="block text-sm font-semibold text-gray-700">
						Number of Fish
					</label>
					<div className="relative">
						<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
							<Fish className="h-5 w-5" />
						</div>
						<input
							type="number"
							id="sampleCount"
							name="sampleCount"
							required
							min="1"
							className="pl-10 block w-full rounded-xl border-gray-300 shadow-sm focus:border-[var(--ofd-action)] focus:ring-[var(--ofd-action)] sm:text-sm bg-gray-50 p-3 outline-none border transition-colors"
							placeholder="e.g. 50"
							value={count}
							onChange={(e) => setCount(e.target.value)}
						/>
					</div>
				</div>

				<div className="space-y-2 md:col-span-2">
					<label htmlFor="sampleLengthCm" className="block text-sm font-semibold text-gray-700">
						Average Length (cm)
					</label>
					<div className="relative">
						<div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
							<Ruler className="h-5 w-5" />
						</div>
						<input
							type="number"
							step="0.1"
							id="sampleLengthCm"
							name="sampleLengthCm"
							required
							min="0.1"
							className="pl-10 block w-full rounded-xl border-gray-300 shadow-sm focus:border-[var(--ofd-action)] focus:ring-[var(--ofd-action)] sm:text-sm bg-gray-50 p-3 outline-none border transition-colors"
							placeholder="e.g. 15.5"
							value={lengthCm}
							onChange={(e) => setLengthCm(e.target.value)}
						/>
					</div>
				</div>
			</div>

			{nextFeedingG > 0 && (
				<div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mt-8 animate-in slide-in-from-bottom-2 fade-in duration-300">
					<h4 className="text-blue-800 font-bold mb-1 flex items-center gap-2">
						<Fish className="h-5 w-5" /> Live Preview
					</h4>
					<p className="text-sm text-blue-700 leading-relaxed">
						Calculated Average Body Weight (ABW): <strong>{avgWeightG.toFixed(1)}g</strong>. <br />
						Assuming 5,000 fish at a {feedingRatePct}% daily feeding rate across {feedsPerDay}{" "}
						feeds, this sample will set your next scheduled feeding to approximately{" "}
						<strong>{nextFeedingG.toLocaleString()}g</strong>.
					</p>
				</div>
			)}

			<div className="pt-4">
				<button
					type="submit"
					disabled={isPending}
					className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-[var(--ofd-action)] hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ofd-action)] disabled:opacity-70 disabled:cursor-not-allowed transition-all"
				>
					{isPending ? (
						<>
							<Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" /> Saving...
						</>
					) : (
						"Save Sample"
					)}
				</button>
			</div>
		</form>
	);
}
