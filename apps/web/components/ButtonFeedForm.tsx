"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import { BUTTON_FEED_GRAMS_MAX, BUTTON_FEED_GRAMS_MIN } from "@/lib/limits";
import type { ButtonFeedConfirmation } from "@/lib/settings/button-feed";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type SaveAction = (
	deviceId: string,
	buttonFeedGrams: number,
) => Promise<{ success: boolean; error?: string; buttonFeedGrams?: number }>;

export interface ButtonFeedFormReport {
	/** What the device row currently holds; the poll sends this value. */
	storedGrams: number;
	/** The dose the device reported on its last press, or null. */
	lastPressGrams: number | null;
	/** Farm-time label for the press, formatted by the server. */
	lastPressAtLabel: string | null;
	confirmation: ButtonFeedConfirmation;
}

interface ButtonFeedFormProps {
	deviceId: string;
	report: ButtonFeedFormReport;
	saveAction: SaveAction;
	canWrite?: boolean;
}

// The firmware's own `button_feed_grams` envelope (`firmware/firmware-main/config.h`)
// is 1-5,000 g; the server schema imports the same constants, so the input refuses
// an out-of-range value before any request is made.
const BUTTON_FEED_RULES = {
	min: BUTTON_FEED_GRAMS_MIN,
	max: BUTTON_FEED_GRAMS_MAX,
	decimals: 2,
	step: 1,
} as const;

function formatGrams(grams: number): string {
	return String(Number(grams.toFixed(2)));
}

/**
 * The physical button's dose, beside the daily feed ceiling (issue #658).
 *
 * The input is the value a save writes; the block underneath is what the
 * device reported. A write is only a promise until the unit polls, so the last
 * button-press weight is shown next to the saved value and a press that
 * predates the change (or dispensed a different weight) is called out instead
 * of being presented as success.
 */
export function ButtonFeedForm({
	deviceId,
	report,
	saveAction,
	canWrite = true,
}: ButtonFeedFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const router = useRouter();
	const [doseInput, setDoseInput] = useState(() => String(report.storedGrams));
	// The last accepted value, so the page can tell an edit from a save (#403).
	const [savedInput, setSavedInput] = useState(doseInput);
	useReportUnsavedChanges(`button-feed-${deviceId}`, doseInput !== savedInput);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const dose = parseCalibrationNumber(doseInput, BUTTON_FEED_RULES);
	const isDirty = doseInput !== savedInput;
	const fieldId = `buttonFeedGrams-${deviceId}`;

	const handleSave = () => {
		if (!canWrite || dose.status !== "valid") return;
		const nextDose = dose.value;
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveAction(deviceId, nextDose);
			if (!result.success) {
				const message = result.error ?? t("buttonFeedError");
				setError(message);
				toast.error(message);
				return;
			}

			// The server's stored value is authoritative (e.g. a rounded float),
			// so the field shows what was written, not only what was typed.
			const stored = result.buttonFeedGrams ?? nextDose;
			setDoseInput(String(stored));
			setSavedInput(String(stored));
			setSaved(true);
			toast.success(t("buttonFeedSaved"));
			router.refresh();
		});
	};

	const pressReport =
		report.lastPressGrams !== null && report.lastPressAtLabel
			? t("buttonFeedLastPress", {
					grams: formatGrams(report.lastPressGrams),
					when: report.lastPressAtLabel,
				})
			: null;

	const unconfirmed =
		report.confirmation === "unconfirmed" && pressReport !== null
			? t("buttonFeedUnconfirmed", {
					grams: formatGrams(report.lastPressGrams ?? 0),
					when: report.lastPressAtLabel ?? "",
				})
			: null;

	const reportTone =
		report.confirmation === "confirmed"
			? "border-[#1E7B34]/30 bg-[#1E7B34]/5 dark:border-green-900/50 dark:bg-green-900/20"
			: report.confirmation === "unconfirmed" ||
					report.confirmation === "no_press" ||
					report.confirmation === "unavailable"
				? "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
				: "border-[#0A3D62]/10 bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-800/60";

	return (
		<div className="space-y-4">
			<div className={calibrationFieldGrid}>
				<CalibrationNumberField
					id={fieldId}
					label={t("buttonFeedLabel")}
					unit="g"
					value={doseInput}
					onValueChange={setDoseInput}
					disabled={!canWrite || isPending}
					help={t("buttonFeedHint")}
					{...BUTTON_FEED_RULES}
				/>
			</div>

			{isDirty && (
				<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
					{t("buttonFeedUnsaved")}
				</p>
			)}

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("buttonFeedSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={!canWrite || isPending || dose.status !== "valid"}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("buttonFeedSave")}
			</button>

			<div className={cn("rounded-xl border p-4", reportTone)}>
				<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-300">
					{t("buttonFeedReportedTitle")}
				</p>
				{report.confirmation === "unavailable" ? (
					<p className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-300">
						{t("buttonFeedUnavailable")}
					</p>
				) : (
					<>
						<p className="mt-1 text-sm font-medium text-[#0A3D62] dark:text-gray-100">
							{report.confirmation === "no_press"
								? t("buttonFeedAwaitingPress")
								: (pressReport ?? t("buttonFeedNoPress"))}
						</p>
						{report.confirmation === "confirmed" && (
							<p className="mt-1 text-xs font-medium text-[#1E7B34] dark:text-green-300">
								{t("buttonFeedConfirmed")}
							</p>
						)}
						{unconfirmed && (
							<p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">
								{unconfirmed}
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}
