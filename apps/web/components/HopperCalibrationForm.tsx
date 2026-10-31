"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import { saveHopperCalibration } from "@/lib/actions/energy";
import {
	DEFAULT_HOPPER_BULK_DENSITY_G_CM3,
	HOPPER_CAPACITY_G_MAX,
	HOPPER_DENSITY_G_CM3_MAX,
	HOPPER_DENSITY_G_CM3_MIN,
	HOPPER_DIAMETER_CM_MAX,
	HOPPER_DIAMETER_CM_MIN,
	HOPPER_EMPTY_CM_MAX,
	HOPPER_FULL_CM_MAX,
	hopperCapacityFromGeometry,
	hopperUsableVolumeL,
} from "@/lib/limits";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface HopperCalibrationFormProps {
	deviceId: string;
	hopperFullCm: number | null;
	hopperEmptyCm: number | null;
	hopperCapacityG: number | null;
	/** Issue #415 geometry; absent on devices calibrated before it existed. */
	hopperDiameterCm?: number | null;
	hopperBulkDensityGCm3?: number | null;
	canWrite?: boolean;
}

const DEFAULT_FULL_CM = 5;
const DEFAULT_EMPTY_CM = 30;

export function HopperCalibrationForm({
	deviceId,
	hopperFullCm,
	hopperEmptyCm,
	hopperCapacityG,
	hopperDiameterCm = null,
	hopperBulkDensityGCm3 = null,
	canWrite = true,
}: HopperCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const locale = useLocale();
	// Strings, not numbers: a numeric state cannot be cleared while typing
	// (`Number("")` is 0, which snaps the zero back into the input). Issue #307.
	const [fullCm, setFullCm] = useState(() => String(hopperFullCm ?? DEFAULT_FULL_CM));
	const [emptyCm, setEmptyCm] = useState(() => String(hopperEmptyCm ?? DEFAULT_EMPTY_CM));
	// No guessed diameter: the operator measures the tank. Empty means "keep
	// the stored capacity" for devices calibrated before #415.
	const [diameterCm, setDiameterCm] = useState(() =>
		hopperDiameterCm === null ? "" : String(hopperDiameterCm),
	);
	const [densityGCm3, setDensityGCm3] = useState(() =>
		hopperBulkDensityGCm3 === null ? "" : String(hopperBulkDensityGCm3),
	);
	const [savedInputs, setSavedInputs] = useState(() =>
		[fullCm, emptyCm, diameterCm, densityGCm3].join("|"),
	);
	useReportUnsavedChanges(
		`hopper-${deviceId}`,
		[fullCm, emptyCm, diameterCm, densityGCm3].join("|") !== savedInputs,
	);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	// Centimetre fields accept one decimal (owner decision, 2026-10-29) so a
	// stored 12.3 stays 12.3 instead of being rejected, but the steppers still
	// move a whole centimetre at a time.
	const fullRules = { min: 0, max: HOPPER_FULL_CM_MAX, decimals: 1, step: 1 } as const;
	const emptyRules = { min: 0, max: HOPPER_EMPTY_CM_MAX, decimals: 1, step: 1 } as const;
	const diameterRules = {
		min: HOPPER_DIAMETER_CM_MIN,
		max: HOPPER_DIAMETER_CM_MAX,
		decimals: 1,
		step: 1,
	} as const;
	const densityRules = {
		min: HOPPER_DENSITY_G_CM3_MIN,
		max: HOPPER_DENSITY_G_CM3_MAX,
		decimals: 2,
		step: 0.05,
	} as const;

	const full = parseCalibrationNumber(fullCm, fullRules);
	const empty = parseCalibrationNumber(emptyCm, emptyRules);
	const diameter = parseCalibrationNumber(diameterCm, diameterRules);
	const density = parseCalibrationNumber(densityGCm3, densityRules);
	const inverted = full.status === "valid" && empty.status === "valid" && empty.value <= full.value;

	// The same pure helpers the server action uses, so the preview can never
	// disagree with what gets stored (issue #415).
	const effectiveDensity =
		density.status === "valid" ? density.value : DEFAULT_HOPPER_BULK_DENSITY_G_CM3;
	const geometryReady =
		diameter.status === "valid" && full.status === "valid" && empty.status === "valid" && !inverted;
	const volumeL = geometryReady
		? hopperUsableVolumeL({
				diameterCm: diameter.value,
				fullCm: full.value,
				emptyCm: empty.value,
			})
		: null;
	const computedCapacity = geometryReady
		? hopperCapacityFromGeometry(
				{ diameterCm: diameter.value, fullCm: full.value, emptyCm: empty.value },
				effectiveDensity,
			)
		: null;
	const capacityOutOfRange = computedCapacity !== null && computedCapacity > HOPPER_CAPACITY_G_MAX;

	// Without a diameter the stored capacity is kept, so devices calibrated
	// before #415 can still save a distance correction.
	const keepsStoredCapacity = diameter.status === "empty" && hopperCapacityG !== null;
	const canSave =
		canWrite &&
		full.status === "valid" &&
		empty.status === "valid" &&
		!inverted &&
		(diameter.status === "empty" || diameter.status === "valid") &&
		(densityGCm3.trim() === "" || density.status === "valid") &&
		!capacityOutOfRange &&
		(computedCapacity !== null || keepsStoredCapacity);

	const formatNumber = (value: number, decimals: number) =>
		new Intl.NumberFormat(locale, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		}).format(value);

	const handleSave = () => {
		if (!canSave) return;
		if (full.status !== "valid" || empty.status !== "valid") return;

		const computed =
			diameter.status === "valid" && !inverted
				? hopperCapacityFromGeometry(
						{ diameterCm: diameter.value, fullCm: full.value, emptyCm: empty.value },
						effectiveDensity,
					)
				: null;
		const capacityToStore = computed ?? hopperCapacityG;
		if (capacityToStore === null) return;

		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveHopperCalibration(deviceId, {
				hopperFullCm: full.value,
				hopperEmptyCm: empty.value,
				// The server recomputes the capacity from the geometry; the
				// capacity is only sent as the legacy fallback when no diameter
				// is set.
				...(diameter.status === "valid"
					? {
							hopperDiameterCm: diameter.value,
							hopperBulkDensityGCm3: effectiveDensity,
						}
					: { hopperCapacityG: capacityToStore }),
			});
			if (result.success) {
				setSavedInputs([fullCm, emptyCm, diameterCm, densityGCm3].join("|"));
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
					id="hopperDiameterCm"
					label={t("hopperDiameterCm")}
					unit="cm"
					value={diameterCm}
					onValueChange={setDiameterCm}
					disabled={!canWrite}
					placeholder={t("hopperDiameterPlaceholder")}
					help={t("hopperDiameterCmDesc")}
					{...diameterRules}
				/>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<CalibrationNumberField
					id="hopperBulkDensityGCm3"
					label={t("hopperBulkDensityGCm3")}
					unit="g/cm³"
					value={densityGCm3}
					onValueChange={setDensityGCm3}
					disabled={!canWrite || diameter.status === "empty"}
					placeholder={String(DEFAULT_HOPPER_BULK_DENSITY_G_CM3)}
					help={t("hopperBulkDensityGCm3Desc")}
					{...densityRules}
				/>
				<div
					className="flex min-w-0 flex-col justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-900/20"
					data-testid="hopper-capacity-summary"
				>
					<p className="text-xs font-bold tracking-wide text-blue-900 uppercase dark:text-blue-100">
						{t("hopperCapacitySummary")}
					</p>
					{capacityOutOfRange ? (
						<p className="mt-1 text-sm font-bold text-[#C42B3A] dark:text-red-300">
							{t("hopperCapacityTooLarge", { max: formatNumber(HOPPER_CAPACITY_G_MAX, 0) })}
						</p>
					) : computedCapacity !== null && volumeL !== null ? (
						<p className="mt-1 text-sm font-bold text-blue-900 dark:text-blue-100">
							{t("hopperCapacityComputed", {
								grams: formatNumber(computedCapacity, 0),
								litres: formatNumber(volumeL, 2),
								density: formatNumber(effectiveDensity, 2),
							})}
						</p>
					) : keepsStoredCapacity ? (
						<p className="mt-1 text-sm font-bold text-blue-900 dark:text-blue-100">
							{t("hopperCapacityStored", {
								grams: formatNumber(hopperCapacityG as number, 0),
							})}
						</p>
					) : (
						<p className="mt-1 text-sm font-medium text-blue-900/80 dark:text-blue-100/80">
							{t("hopperCapacityEnterDiameter")}
						</p>
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
