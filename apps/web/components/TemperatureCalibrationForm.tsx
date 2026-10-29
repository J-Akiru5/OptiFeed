"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { saveTemperatureCalibration } from "@/lib/actions/energy";
import { TEMP_OFFSET_C_MAX, TEMP_OFFSET_C_MIN } from "@/lib/limits";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

interface TemperatureCalibrationFormProps {
	deviceId: string;
	currentTempOffsetC: number;
	currentTempC: number | null;
	canWrite?: boolean;
}

const TEMP_OFFSET_RULES = {
	min: TEMP_OFFSET_C_MIN,
	max: TEMP_OFFSET_C_MAX,
	decimals: 2,
	step: 0.1,
} as const;

export function TemperatureCalibrationForm({
	deviceId,
	currentTempOffsetC,
	currentTempC,
	canWrite = true,
}: TemperatureCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	// String state so the field can be emptied while editing (issue #307).
	const [offsetInput, setOffsetInput] = useState(() => String(currentTempOffsetC));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const offset = parseCalibrationNumber(offsetInput, TEMP_OFFSET_RULES);
	const offsetValue = offset.status === "valid" ? offset.value : null;

	const calibratedTemp = useMemo(() => {
		if (currentTempC === null || offsetValue === null) return null;
		return currentTempC + offsetValue;
	}, [currentTempC, offsetValue]);

	const handleSave = () => {
		if (!canWrite || offset.status !== "valid") return;
		const nextOffset = offset.value;
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveTemperatureCalibration(deviceId, nextOffset);
			if (result.success) {
				setSaved(true);
				toast.success(t("temperatureSaved"));
			} else {
				const message = result.error ?? t("temperatureSaveError");
				setError(message);
				toast.error(message);
			}
		});
	};

	return (
		<div className="space-y-4">
			<div className={cn(calibrationFieldGrid, "items-start")}>
				<CalibrationNumberField
					id="tempOffsetC"
					label={t("tempOffsetLabel")}
					unit="°C"
					value={offsetInput}
					onValueChange={setOffsetInput}
					disabled={!canWrite}
					help={t("tempOffsetHelp")}
					{...TEMP_OFFSET_RULES}
				/>

				<div
					aria-live="polite"
					aria-atomic="true"
					className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/50 dark:bg-sky-900/20 sm:col-span-1 xl:col-span-2"
				>
					<p className="text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">
						{t("temperaturePreviewTitle")}
					</p>
					{currentTempC !== null ? (
						<div className="space-y-1">
							<p className="text-sm text-sky-900 dark:text-sky-100">
								{t("rawReading")}: <strong>{currentTempC.toFixed(1)}°C</strong>
							</p>
							<p className="text-sm text-sky-900 dark:text-sky-100">
								{t("offset")}:{" "}
								<strong>
									{offsetValue === null
										? "—"
										: `${offsetValue >= 0 ? "+" : ""}${offsetValue.toFixed(1)}°C`}
								</strong>
							</p>
							<p className="text-sm font-bold text-sky-950 dark:text-white">
								{t("calibrated")}:{" "}
								<strong>{calibratedTemp === null ? "—" : `${calibratedTemp.toFixed(1)}°C`}</strong>
							</p>
						</div>
					) : (
						<p className="text-sm text-sky-800 dark:text-sky-200">{t("noTemperatureReading")}</p>
					)}
				</div>
			</div>

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("temperatureSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={isPending || !canWrite || offset.status !== "valid"}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("saveCalibration")}
			</button>
		</div>
	);
}
