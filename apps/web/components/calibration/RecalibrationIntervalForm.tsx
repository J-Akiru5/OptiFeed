"use client";

import { saveRecalibrationInterval } from "@/lib/actions/calibration";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const MIN_DAYS = 7;
const MAX_DAYS = 180;

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
	const [value, setValue] = useState(String(currentIntervalDays));
	const [error, setError] = useState<string | null>(null);
	const [isSaving, startSaving] = useTransition();

	const days = Number(value);
	const isValid =
		value.trim() !== "" && Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS;

	const handleSave = () => {
		if (!canWrite || !isValid) return;
		setError(null);

		startSaving(async () => {
			try {
				const result = await saveRecalibrationInterval(deviceId, days);
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
			<div className="flex flex-wrap items-end gap-3">
				<div className="space-y-1">
					<label
						htmlFor="recalibration-interval-days"
						className="text-sm font-medium text-gray-700 dark:text-gray-200"
					>
						{t("label")}
					</label>
					<input
						id="recalibration-interval-days"
						type="number"
						min={MIN_DAYS}
						max={MAX_DAYS}
						step={1}
						inputMode="numeric"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						disabled={!canWrite}
						className="min-h-[var(--ofd-touch-min)] w-28 rounded-lg border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
					/>
				</div>
				<button
					type="button"
					onClick={handleSave}
					disabled={!canWrite || !isValid || isSaving}
					className="flex min-h-[var(--ofd-touch-min)] items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
					{isSaving ? t("saving") : t("saveButton")}
				</button>
			</div>
			<p className="text-xs text-gray-500 dark:text-gray-400">
				{t("help", { min: MIN_DAYS, max: MAX_DAYS })}
			</p>
			{value.trim() !== "" && !isValid && (
				<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
					{t("invalid", { min: MIN_DAYS, max: MAX_DAYS })}
				</p>
			)}
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
