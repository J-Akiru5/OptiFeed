"use client";

import { saveTemperatureCalibration } from "@/lib/actions/energy";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

interface TemperatureCalibrationFormProps {
	deviceId: string;
	currentTempOffsetC: number;
	currentTempC: number | null;
}

export function TemperatureCalibrationForm({
	deviceId,
	currentTempOffsetC,
	currentTempC,
}: TemperatureCalibrationFormProps) {
	const [offset, setOffset] = useState(currentTempOffsetC);
	const [isPending, startTransition] = useTransition();

	const calibratedTemp = useMemo(() => {
		if (currentTempC === null) return null;
		return currentTempC + offset;
	}, [currentTempC, offset]);

	const handleSave = () => {
		startTransition(async () => {
			const result = await saveTemperatureCalibration(deviceId, Number(offset));
			if (result.success) {
				toast.success("Temperature calibration saved!");
			} else {
				toast.error(result.error ?? "Failed to save calibration");
			}
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-2">
				<label htmlFor="tempOffsetC" className="text-sm font-medium text-gray-700">
					Temperature Offset (°C)
				</label>
				<p className="text-xs text-gray-400">
					Compare with a known-accurate thermometer. If sensor reads 28.5°C but thermometer says
					27.8°C, enter -0.7.
				</p>
				<input
					id="tempOffsetC"
					type="number"
					min={-20}
					max={20}
					step={0.1}
					value={offset}
					onChange={(e) => setOffset(Number(e.target.value))}
					className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
				/>
			</div>

			<div className="rounded-xl bg-sky-50 border border-sky-200 p-4 space-y-2">
				<p className="text-xs font-bold text-sky-700 uppercase tracking-wide">
					Calibration Preview
				</p>
				{currentTempC !== null ? (
					<div className="space-y-1">
						<p className="text-sm text-sky-800">
							Raw reading: <strong>{currentTempC.toFixed(1)}°C</strong>
						</p>
						<p className="text-sm text-sky-800">
							Offset:{" "}
							<strong>
								{offset >= 0 ? "+" : ""}
								{offset.toFixed(1)}°C
							</strong>
						</p>
						<p className="text-sm font-bold text-sky-900">
							Calibrated: <strong>{calibratedTemp?.toFixed(1)}°C</strong>
						</p>
					</div>
				) : (
					<p className="text-sm text-sky-600">
						No temperature reading yet. Sensor will report once DS18B20 is connected.
					</p>
				)}
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
