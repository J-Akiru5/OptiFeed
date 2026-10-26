"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { saveTemperatureCalibration } from "@/lib/actions/energy";
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

export function TemperatureCalibrationForm({
	deviceId,
	currentTempOffsetC,
	currentTempC,
	canWrite = true,
}: TemperatureCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const [offset, setOffset] = useState(currentTempOffsetC);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const calibratedTemp = useMemo(() => {
		if (currentTempC === null) return null;
		return currentTempC + offset;
	}, [currentTempC, offset]);

	const handleSave = () => {
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveTemperatureCalibration(deviceId, Number(offset));
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
			<div>
				<label htmlFor="tempOffsetC" className={dashboardLabel}>
					{t("tempOffsetLabel")}
				</label>
				<input
					id="tempOffsetC"
					type="number"
					min={-20}
					max={20}
					step={0.1}
					inputMode="decimal"
					value={offset}
					onChange={(e) => setOffset(Number(e.target.value))}
					disabled={!canWrite}
					className={dashboardField}
				/>
				<span className={dashboardHint}>{t("tempOffsetHelp")}</span>
			</div>

			<div
				aria-live="polite"
				aria-atomic="true"
				className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/50 dark:bg-sky-900/20"
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
								{offset >= 0 ? "+" : ""}
								{offset.toFixed(1)}°C
							</strong>
						</p>
						<p className="text-sm font-bold text-sky-950 dark:text-white">
							{t("calibrated")}: <strong>{calibratedTemp?.toFixed(1)}°C</strong>
						</p>
					</div>
				) : (
					<p className="text-sm text-sky-800 dark:text-sky-200">{t("noTemperatureReading")}</p>
				)}
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
				disabled={isPending || !canWrite}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("saveCalibration")}
			</button>
		</div>
	);
}
