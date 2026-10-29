"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { saveRecalibrationInterval } from "@/lib/actions/calibration";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const MIN_DAYS = 7;
const MAX_DAYS = 180;
const INTERVAL_RULES = { min: MIN_DAYS, max: MAX_DAYS, decimals: 0, step: 1 } as const;

interface RecalibrationIntervalFormProps {
	deviceId: string;
	currentIntervalDays: number;
	canWrite?: boolean;
}

export function RecalibrationIntervalForm({
	deviceId,
	currentIntervalDays,
	canWrite = true,
}: RecalibrationIntervalFormProps) {
	const t = useTranslations("dashboard.appSettings.calibration.recalibration");
	const router = useRouter();
	// String state so the field can be cleared and retyped (issue #307).
	const [value, setValue] = useState(() => String(currentIntervalDays));
	const [error, setError] = useState<string | null>(null);
	const [isSaving, startSaving] = useTransition();

	const days = parseCalibrationNumber(value, INTERVAL_RULES);

	const handleSave = () => {
		if (!canWrite || days.status !== "valid") return;
		const nextDays = days.value;
		setError(null);

		startSaving(async () => {
			try {
				const result = await saveRecalibrationInterval(deviceId, nextDays);
				if (!result.success) {
					setError(result.error ?? t("saveError"));
					return;
				}
				toast.success(t("saved"));
				router.refresh();
			} catch {
				setError(t("saveError"));
			}
		});
	};

	return (
		<div className="space-y-2" data-help="recalibration-interval">
			<div className={cn(calibrationFieldGrid, "items-end")}>
				<CalibrationNumberField
					id="recalibration-interval-days"
					label={t("label")}
					unit="d"
					value={value}
					onValueChange={setValue}
					disabled={!canWrite}
					help={t("help", { min: MIN_DAYS, max: MAX_DAYS })}
					{...INTERVAL_RULES}
				/>
				<div>
					<button
						type="button"
						onClick={handleSave}
						disabled={!canWrite || days.status !== "valid" || isSaving}
						className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:outline-[#8fc0ea] sm:w-auto"
					>
						{isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
						{isSaving ? t("saving") : t("saveButton")}
					</button>
				</div>
			</div>
			{error && (
				<p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			{!canWrite && (
				<p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t("readOnly")}</p>
			)}
		</div>
	);
}
