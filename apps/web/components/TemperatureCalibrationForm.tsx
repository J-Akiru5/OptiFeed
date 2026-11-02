"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import { saveTemperatureCalibration } from "@/lib/actions/energy";
import {
	MIN_FEED_TEMP_C_MAX,
	MIN_FEED_TEMP_C_MIN,
	TEMP_OFFSET_C_MAX,
	TEMP_OFFSET_C_MIN,
} from "@/lib/limits";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

interface TemperatureCalibrationFormProps {
	deviceId: string;
	currentTempOffsetC: number;
	currentTempC: number | null;
	currentMinFeedTempC?: number | null;
	canWrite?: boolean;
}

const TEMP_OFFSET_RULES = {
	min: TEMP_OFFSET_C_MIN,
	max: TEMP_OFFSET_C_MAX,
	decimals: 2,
	step: 0.1,
} as const;

// The warn-only feeding minimum (issue #486). One decimal is enough for water
// temperature, and an empty field means "no limit set" rather than 0 °C.
const MIN_FEED_TEMP_RULES = {
	min: MIN_FEED_TEMP_C_MIN,
	max: MIN_FEED_TEMP_C_MAX,
	decimals: 1,
	step: 0.5,
} as const;

export function TemperatureCalibrationForm({
	deviceId,
	currentTempOffsetC,
	currentTempC,
	currentMinFeedTempC = null,
	canWrite = true,
}: TemperatureCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	// String state so the field can be emptied while editing (issue #307).
	const [offsetInput, setOffsetInput] = useState(() => String(currentTempOffsetC));
	const [minFeedInput, setMinFeedInput] = useState(() =>
		currentMinFeedTempC === null ? "" : String(currentMinFeedTempC),
	);
	const [savedOffsetInput, setSavedOffsetInput] = useState(offsetInput);
	const [savedMinFeedInput, setSavedMinFeedInput] = useState(minFeedInput);
	useReportUnsavedChanges(
		`temperature-${deviceId}`,
		offsetInput !== savedOffsetInput || minFeedInput !== savedMinFeedInput,
	);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const offset = parseCalibrationNumber(offsetInput, TEMP_OFFSET_RULES);
	const offsetValue = offset.status === "valid" ? offset.value : null;
	// Empty is a valid state here: it means the pond has no minimum, so the
	// dashboard stays silent instead of inventing a safe temperature.
	const minFeed = parseCalibrationNumber(minFeedInput, MIN_FEED_TEMP_RULES);
	const minFeedValue =
		minFeed.status === "empty" ? null : minFeed.status === "valid" ? minFeed.value : null;
	const minFeedResolved = minFeed.status !== "invalid";

	const calibratedTemp = useMemo(() => {
		if (currentTempC === null || offsetValue === null) return null;
		return currentTempC + offsetValue;
	}, [currentTempC, offsetValue]);

	const belowMinimum =
		calibratedTemp !== null && minFeedValue !== null && calibratedTemp < minFeedValue;

	const handleSave = () => {
		if (!canWrite || offset.status !== "valid" || !minFeedResolved) return;
		const nextOffset = offset.value;
		const nextMinFeed = minFeedValue;
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveTemperatureCalibration(deviceId, nextOffset, nextMinFeed);
			if (result.success) {
				setSavedOffsetInput(offsetInput);
				setSavedMinFeedInput(minFeedInput);
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

				<CalibrationNumberField
					id="minFeedTempC"
					label={t("minFeedTempLabel")}
					unit="°C"
					value={minFeedInput}
					onValueChange={setMinFeedInput}
					disabled={!canWrite}
					placeholder={t("minFeedTempPlaceholder")}
					help={t("minFeedTempHelp")}
					{...MIN_FEED_TEMP_RULES}
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
							{belowMinimum && (
								<p className="text-sm font-bold text-[#B45309] dark:text-amber-300">
									{t("minFeedTempBelow", { min: minFeedValue ?? 0 })}
								</p>
							)}
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
				disabled={isPending || !canWrite || offset.status !== "valid" || !minFeedResolved}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("saveCalibration")}
			</button>
		</div>
	);
}
