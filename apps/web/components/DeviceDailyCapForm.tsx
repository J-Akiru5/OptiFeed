"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import {
	DAILY_CAP_MIN_G,
	DEFAULT_DAILY_CAP_G,
	MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
} from "@/lib/limits";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type SaveAction = (
	deviceId: string,
	dailyCapG: number,
) => Promise<{ success: boolean; error?: string; dailyCapG?: number }>;

interface DeviceDailyCapFormProps {
	deviceId: string;
	/** Stored ceiling; null means the 2,000 g default applies. */
	currentCapG: number | null;
	saveAction: SaveAction;
	canWrite?: boolean;
}

// Whole grams only, matching the schema, and a 50 g stepper because a ceiling
// is tuned in coarse increments rather than 1 g at a time.
const DAILY_CAP_RULES = {
	min: DAILY_CAP_MIN_G,
	max: MAX_FEED_GRAMS_PER_DAY_PER_DEVICE,
	decimals: 0,
	step: 50,
} as const;

/**
 * The farmer- and admin-editable daily feed ceiling.
 *
 * The stored value is only ever a request: `resolveDailyCapG` clamps it to the
 * 500-5,000 g window and applies the platform factor wherever the cap is
 * enforced, so an edited or stale row cannot raise the real ceiling.
 */
export function DeviceDailyCapForm({
	deviceId,
	currentCapG,
	saveAction,
	canWrite = true,
}: DeviceDailyCapFormProps) {
	const t = useTranslations("dashboard.appSettings");
	// String, not number: a numeric state cannot be cleared while typing
	// (`Number("")` is 0, which snaps the zero straight back). Issue #307.
	const [capInput, setCapInput] = useState(() => String(currentCapG ?? DEFAULT_DAILY_CAP_G));
	// The last saved value, so the settings page can tell an edit from a save (#403).
	const [savedInput, setSavedInput] = useState(capInput);
	useReportUnsavedChanges(`daily-cap-${deviceId}`, capInput !== savedInput);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const cap = parseCalibrationNumber(capInput, DAILY_CAP_RULES);
	// The admin pond page renders one form per device, so the id (which also
	// names the help and error nodes) has to be unique per device.
	const fieldId = `dailyCapG-${deviceId}`;

	const handleSave = () => {
		if (!canWrite || cap.status !== "valid") return;
		const nextCapG = cap.value;
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveAction(deviceId, nextCapG);
			if (result.success) {
				setSavedInput(capInput);
				setSaved(true);
				toast.success(t("dailyCeilingSaved"));
			} else {
				const message = result.error ?? t("dailyCeilingError");
				setError(message);
				toast.error(message);
			}
		});
	};

	return (
		<div className="space-y-4" data-help="device-daily-ceiling">
			<div className={calibrationFieldGrid}>
				<CalibrationNumberField
					id={fieldId}
					label={t("dailyCeilingLabel")}
					unit="g/day"
					value={capInput}
					onValueChange={setCapInput}
					disabled={!canWrite || isPending}
					help={t("dailyCeilingHint")}
					{...DAILY_CAP_RULES}
				/>
			</div>

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("dailyCeilingSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={!canWrite || isPending || cap.status !== "valid"}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("dailyCeilingSave")}
			</button>
		</div>
	);
}
