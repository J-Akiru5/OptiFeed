"use client";

import { saveDurationCalibration } from "@/lib/actions/energy";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

interface DurationCalibrationFormProps {
	deviceId: string;
	currentGramsPerSecond: number;
	currentGramsPerFeeding: number;
}

export function DurationCalibrationForm({
	deviceId,
	currentGramsPerSecond,
	currentGramsPerFeeding,
}: DurationCalibrationFormProps) {
	const [gps, setGps] = useState(currentGramsPerSecond);
	const [testSeconds, setTestSeconds] = useState(10);
	const [isPending, startTransition] = useTransition();

	const feedDuration = useMemo(() => {
		if (gps <= 0) return 0;
		return currentGramsPerFeeding / gps;
	}, [gps, currentGramsPerFeeding]);

	const testGrams = useMemo(() => {
		return gps * testSeconds;
	}, [gps, testSeconds]);

	const handleSave = () => {
		startTransition(async () => {
			const result = await saveDurationCalibration(deviceId, Number(gps));
			if (result.success) {
				toast.success("Duration calibration saved!");
			} else {
				toast.error(result.error ?? "Failed to save calibration");
			}
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-2">
				<label htmlFor="gramsPerSecond" className="text-sm font-medium text-gray-700">
					Grams per Second (g/s)
				</label>
				<p className="text-xs text-gray-400">
					Run the motor for a fixed time, weigh the output, then divide grams by seconds.
				</p>
				<input
					id="gramsPerSecond"
					type="number"
					min={0.1}
					max={100}
					step={0.1}
					value={gps}
					onChange={(e) => setGps(Number(e.target.value))}
					className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
			</div>

			<div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-2">
				<p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Live Preview</p>
				<p className="text-sm text-blue-800">
					At <strong>{gps.toFixed(1)} g/s</strong>, a <strong>{currentGramsPerFeeding}g</strong>{" "}
					feed takes <strong>{feedDuration.toFixed(1)} seconds</strong>
				</p>
			</div>

			<div className="border-t border-gray-100 pt-4">
				<p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
					Quick Calculator
				</p>
				<div className="flex flex-col gap-2">
					<label htmlFor="testSeconds" className="text-sm font-medium text-gray-700">
						Run motor for (seconds)
					</label>
					<input
						id="testSeconds"
						type="number"
						min={1}
						max={300}
						step={1}
						value={testSeconds}
						onChange={(e) => setTestSeconds(Number(e.target.value))}
						className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
					/>
					<p className="text-sm text-gray-600">
						Dispenses approximately <strong>{testGrams.toFixed(1)} grams</strong>
					</p>
				</div>
			</div>

			<button
				type="button"
				onClick={handleSave}
				disabled={isPending}
				className="flex min-h-[var(--ofd-touch-min)] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{isPending ? "Saving..." : "Save Calibration"}
			</button>
		</div>
	);
}
