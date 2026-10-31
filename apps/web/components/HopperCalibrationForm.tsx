"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import { saveHopperCalibration } from "@/lib/actions/energy";
import { HOPPER_CAPACITY_G_MAX, HOPPER_EMPTY_CM_MAX, HOPPER_FULL_CM_MAX } from "@/lib/limits";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface HopperCalibrationFormProps {
	deviceId: string;
	hopperFullCm: number | null;
	hopperEmptyCm: number | null;
	hopperCapacityG: number | null;
	canWrite?: boolean;
}

const DEFAULT_FULL_CM = 5;
const DEFAULT_EMPTY_CM = 30;
const DEFAULT_CAPACITY_G = 7000;

export function HopperCalibrationForm({
	deviceId,
	hopperFullCm,
	hopperEmptyCm,
	hopperCapacityG,
	canWrite = true,
}: HopperCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	// Strings, not numbers: a numeric state cannot be cleared while typing
	// (`Number("")` is 0, which snaps the zero back into the input). Issue #307.
	const [fullCm, setFullCm] = useState(() => String(hopperFullCm ?? DEFAULT_FULL_CM));
	const [emptyCm, setEmptyCm] = useState(() => String(hopperEmptyCm ?? DEFAULT_EMPTY_CM));
	const [capacityG, setCapacityG] = useState(() => String(hopperCapacityG ?? DEFAULT_CAPACITY_G));
	const [savedInputs, setSavedInputs] = useState(() => [fullCm, emptyCm, capacityG].join("|"));
	useReportUnsavedChanges(
		`hopper-${deviceId}`,
		[fullCm, emptyCm, capacityG].join("|") !== savedInputs,
	);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	// Centimetre fields accept one decimal (owner decision, 2026-10-29) so a
	// stored 12.3 stays 12.3 instead of being rejected, but the steppers still
	// move a whole centimetre at a time.
	const fullRules = { min: 0, max: HOPPER_FULL_CM_MAX, decimals: 1, step: 1 } as const;
	const emptyRules = { min: 0, max: HOPPER_EMPTY_CM_MAX, decimals: 1, step: 1 } as const;
	const capacityRules = { min: 1, max: HOPPER_CAPACITY_G_MAX, decimals: 0 } as const;

	const full = parseCalibrationNumber(fullCm, fullRules);
	const empty = parseCalibrationNumber(emptyCm, emptyRules);
	const capacity = parseCalibrationNumber(capacityG, capacityRules);
	const inverted = full.status === "valid" && empty.status === "valid" && empty.value <= full.value;
	const canSave =
		canWrite &&
		full.status === "valid" &&
		empty.status === "valid" &&
		capacity.status === "valid" &&
		!inverted;

	const handleSave = () => {
		if (!canWrite) return;
		if (full.status !== "valid" || empty.status !== "valid" || capacity.status !== "valid") return;
		if (empty.value <= full.value) return;

		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveHopperCalibration(deviceId, {
				hopperFullCm: full.value,
				hopperEmptyCm: empty.value,
				hopperCapacityG: capacity.value,
			});
			if (result.success) {
				setSavedInputs([fullCm, emptyCm, capacityG].join("|"));
				setSaved(true);
				toast.success(t("calibrationSaved"));
			} else {
				const message = result.error ?? t("calibrationSaveError");
				setError(message);
				toast.error(message);
			}
		});
	};

	return (
		<div className="space-y-4" data-help="hopper-calibration">
			<div className={calibrationFieldGrid}>
				<CalibrationNumberField
					id="hopperFullCm"
					label={t("hopperFullCm")}
					unit="cm"
					value={fullCm}
					onValueChange={setFullCm}
					disabled={!canWrite}
					help={t("hopperFullCmDesc")}
					{...fullRules}
				/>
				<CalibrationNumberField
					id="hopperEmptyCm"
					label={t("hopperEmptyCm")}
					unit="cm"
					value={emptyCm}
					onValueChange={setEmptyCm}
					disabled={!canWrite}
					help={t("hopperEmptyCmDesc")}
					error={inverted ? t("hopperEmptyGreaterThanFull") : undefined}
					{...emptyRules}
				/>
				<CalibrationNumberField
					id="hopperCapacityG"
					label={t("hopperCapacityG")}
					unit="g"
					value={capacityG}
					onValueChange={setCapacityG}
					disabled={!canWrite}
					help={t("hopperCapacityGDesc")}
					{...capacityRules}
				/>
			</div>

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("calibrationSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={isPending || !canSave}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("saveCalibration")}
			</button>
		</div>
	);
}
