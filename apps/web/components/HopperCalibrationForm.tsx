"use client";

import { saveHopperCalibration } from "@/lib/actions/energy";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface HopperCalibrationFormProps {
	deviceId: string;
	hopperFullCm: number | null;
	hopperEmptyCm: number | null;
	hopperCapacityG: number | null;
}

export function HopperCalibrationForm({
	deviceId,
	hopperFullCm,
	hopperEmptyCm,
	hopperCapacityG,
}: HopperCalibrationFormProps) {
	const [fullCm, setFullCm] = useState(hopperFullCm ?? 5);
	const [emptyCm, setEmptyCm] = useState(hopperEmptyCm ?? 30);
	const [capacityG, setCapacityG] = useState(hopperCapacityG ?? 7000);
	const [isPending, startTransition] = useTransition();

	const handleSave = () => {
		startTransition(async () => {
			const result = await saveHopperCalibration(deviceId, {
				hopperFullCm: Number(fullCm),
				hopperEmptyCm: Number(emptyCm),
				hopperCapacityG: Number(capacityG),
			});
			if (result.success) {
				toast.success("Calibration saved!");
			} else {
				toast.error(result.error ?? "Failed to save calibration");
			}
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-2">
				<label htmlFor="hopperFullCm" className="text-sm font-medium text-gray-700">
					Full Distance (cm)
				</label>
				<p className="text-xs text-gray-400">Sensor reading when hopper is full of feed</p>
				<input
					id="hopperFullCm"
					type="number"
					min={0}
					max={100}
					step={0.1}
					value={fullCm}
					onChange={(e) => setFullCm(Number(e.target.value))}
					className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
			</div>
			<div className="flex flex-col gap-2">
				<label htmlFor="hopperEmptyCm" className="text-sm font-medium text-gray-700">
					Empty Distance (cm)
				</label>
				<p className="text-xs text-gray-400">Sensor reading when hopper is empty</p>
				<input
					id="hopperEmptyCm"
					type="number"
					min={0}
					max={200}
					step={0.1}
					value={emptyCm}
					onChange={(e) => setEmptyCm(Number(e.target.value))}
					className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
			</div>
			<div className="flex flex-col gap-2">
				<label htmlFor="hopperCapacityG" className="text-sm font-medium text-gray-700">
					Hopper Capacity (grams)
				</label>
				<p className="text-xs text-gray-400">Total feed weight the hopper can hold</p>
				<input
					id="hopperCapacityG"
					type="number"
					min={0}
					max={50000}
					step={100}
					value={capacityG}
					onChange={(e) => setCapacityG(Number(e.target.value))}
					className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
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
