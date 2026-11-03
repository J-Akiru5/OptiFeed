"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import { dashboardButtonPrimary } from "@/components/dashboard/dashboard-classes";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import type {
	HopperFilterFieldSpec,
	HopperFilterKey,
	HopperFilterValues,
} from "@/lib/firmware/hopper-filter";
import type { ConfigEchoState, ConfigSource } from "@/lib/settings/config-echo";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * The hopper filter tuning, per device (issue #659).
 *
 * Seven keys that guard the ultrasonic reading against field noise. They were
 * firmware-only constants (`editable: false`, never overlaid), so a bouncing
 * sensor could only be adapted with a new build. The numbers themselves come
 * from `FIRMWARE_FIELDS` via `lib/firmware/hopper-filter.ts`, so the browser
 * bounds and the server schema are the firmware's own envelope rather than a
 * second copy of it.
 *
 * Underneath the inputs is what the *device* reports. A write is only a
 * promise: the unit may be offline, may not have polled yet, or may refuse the
 * whole `config` object. The firmware echoes one `config_rev` for the whole
 * object and never per-key values, so the card shows the last echo and calls
 * the change applied only when that echo came after the change.
 */

type SaveAction = (
	deviceId: string,
	values: HopperFilterValues,
) => Promise<{ success: boolean; error?: string; values?: HopperFilterValues }>;

export interface HopperFilterEchoReport {
	/** False when the device read failed; the card then says so. */
	available: boolean;
	state: ConfigEchoState;
	/** Farm-time label for the last config echo, formatted by the server. */
	reportedAtLabel: string | null;
	/** The revision the unit echoed, or null on pre-1.7.0 firmware. */
	reportedRev: number | null;
	/** Where the unit says its config came from. */
	configSource: ConfigSource | null;
	/** Farm-time label for the last dashboard change, formatted by the server. */
	changedAtLabel: string | null;
}

interface HopperFilterFormProps {
	deviceId: string;
	/** Effective values: a column with no value shows the firmware default. */
	values: HopperFilterValues;
	/**
	 * The firmware envelope per field, passed by the server page. Keeping it a
	 * prop means the client bundle does not import the whole field table for
	 * seven numbers.
	 */
	fields: readonly HopperFilterFieldSpec[];
	/** Keys still running on the firmware default (never written). */
	usingDefaults: readonly HopperFilterKey[];
	report: HopperFilterEchoReport;
	saveAction: SaveAction;
	canWrite?: boolean;
}

/**
 * Decimal places per field. Centimetres and percentages read to one decimal;
 * the EMA weight is the only value that needs two (`0.05` is the minimum).
 */
const DECIMALS: Record<HopperFilterKey, 0 | 1 | 2> = {
	hopper_refill_margin_pct: 1,
	hopper_reject_below_cm: 1,
	hopper_reject_above_margin_cm: 1,
	hopper_ema_alpha: 2,
	hopper_jump_pct: 1,
	hopper_persist_cycles: 0,
	hopper_state_hold_s: 0,
};

/** Stepper increments: whole percentages/centimetres, 0.05 alpha, 30 s holds. */
const STEPS: Record<HopperFilterKey, number> = {
	hopper_refill_margin_pct: 1,
	hopper_reject_below_cm: 1,
	hopper_reject_above_margin_cm: 1,
	hopper_ema_alpha: 0.05,
	hopper_jump_pct: 1,
	hopper_persist_cycles: 1,
	hopper_state_hold_s: 30,
};

const UNITS: Record<HopperFilterKey, string> = {
	hopper_refill_margin_pct: "%",
	hopper_reject_below_cm: "cm",
	hopper_reject_above_margin_cm: "cm",
	hopper_ema_alpha: "",
	hopper_jump_pct: "%",
	hopper_persist_cycles: "",
	hopper_state_hold_s: "s",
};

/** i18n key for each field, kept as literals so a rename fails the copy test. */
const LABEL_KEY = {
	hopper_refill_margin_pct: "hopperFilterRefillMargin",
	hopper_reject_below_cm: "hopperFilterRejectBelow",
	hopper_reject_above_margin_cm: "hopperFilterRejectAbove",
	hopper_ema_alpha: "hopperFilterEmaAlpha",
	hopper_jump_pct: "hopperFilterJumpPct",
	hopper_persist_cycles: "hopperFilterPersistCycles",
	hopper_state_hold_s: "hopperFilterStateHold",
} as const satisfies Record<HopperFilterKey, string>;

const HELP_KEY = {
	hopper_refill_margin_pct: "hopperFilterRefillMarginDesc",
	hopper_reject_below_cm: "hopperFilterRejectBelowDesc",
	hopper_reject_above_margin_cm: "hopperFilterRejectAboveDesc",
	hopper_ema_alpha: "hopperFilterEmaAlphaDesc",
	hopper_jump_pct: "hopperFilterJumpPctDesc",
	hopper_persist_cycles: "hopperFilterPersistCyclesDesc",
	hopper_state_hold_s: "hopperFilterStateHoldDesc",
} as const satisfies Record<HopperFilterKey, string>;

function initialInputs(
	values: HopperFilterValues,
	fields: readonly HopperFilterFieldSpec[],
): Record<HopperFilterKey, string> {
	const inputs = {} as Record<HopperFilterKey, string>;
	for (const field of fields) {
		inputs[field.id] = String(values[field.id]);
	}
	return inputs;
}

export function HopperFilterForm({
	deviceId,
	values,
	fields,
	usingDefaults,
	report,
	saveAction,
	canWrite = true,
}: HopperFilterFormProps) {
	const t = useTranslations("dashboard.appSettings");
	const [inputs, setInputs] = useState(() => initialInputs(values, fields));
	const [savedInputs, setSavedInputs] = useState(() =>
		shownKey(initialInputs(values, fields), fields),
	);
	useReportUnsavedChanges(`hopper-filter-${deviceId}`, shownKey(inputs, fields) !== savedInputs);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [isPending, startTransition] = useTransition();

	const parsed = fields.map((field) => {
		const key = field.id;
		const rules = { min: field.min, max: field.max, decimals: DECIMALS[key], step: STEPS[key] };
		return { field, key, rules, result: parseCalibrationNumber(inputs[key], rules) };
	});
	const allValid = parsed.every((entry) => entry.result.status === "valid");
	const dirty = shownKey(inputs, fields) !== savedInputs;

	const handleSave = () => {
		if (!canWrite || !allValid) return;
		const next = Object.fromEntries(
			parsed.map(({ key, result }) => [key, result.status === "valid" ? result.value : 0]),
		) as HopperFilterValues;
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveAction(deviceId, next);
			if (!result.success) {
				const message = result.error ?? t("hopperFilterError");
				setError(message);
				toast.error(message);
				return;
			}
			// The stored values are authoritative (the server clamps and the
			// firmware re-validates), so the fields show what was written.
			const stored = result.values ?? next;
			const storedInputs = initialInputs(stored, fields);
			setInputs(storedInputs);
			setSavedInputs(shownKey(storedInputs, fields));
			setSaved(true);
			toast.success(t("hopperFilterSaved"));
		});
	};

	const echoTone =
		report.state === "applied"
			? "border-[#1E7B34]/30 bg-[#1E7B34]/5 dark:border-green-900/50 dark:bg-green-900/20"
			: report.state === "reported"
				? "border-[#0A3D62]/10 bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-800/60"
				: "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20";

	const echoSummary = !report.available
		? t("hopperFilterEchoUnavailable")
		: report.state === "never_reported"
			? t("hopperFilterEchoNever")
			: report.state === "reported"
				? t("hopperFilterEchoReported", { when: report.reportedAtLabel ?? "—" })
				: report.state === "applied"
					? t("hopperFilterEchoApplied", { when: report.reportedAtLabel ?? "—" })
					: t("hopperFilterEchoPending", { when: report.reportedAtLabel ?? "—" });

	return (
		<div className="space-y-4">
			<div className={calibrationFieldGrid}>
				{parsed.map(({ field, key, rules }) => (
					<CalibrationNumberField
						key={key}
						id={`hopperFilter-${key}`}
						label={t(LABEL_KEY[key])}
						unit={UNITS[key]}
						value={inputs[key]}
						onValueChange={(next) => setInputs((current) => ({ ...current, [key]: next }))}
						disabled={!canWrite || isPending}
						help={t(HELP_KEY[key])}
						{...rules}
					/>
				))}
			</div>

			{usingDefaults.length > 0 && (
				<p className="text-xs font-medium text-[#3D5568] dark:text-gray-400">
					{t("hopperFilterUsingDefaults", { count: usingDefaults.length })}
				</p>
			)}

			{dirty && (
				<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
					{t("hopperFilterUnsaved")}
				</p>
			)}

			{error && (
				<p role="alert" className="text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
			{saved && (
				<output className="block text-sm font-bold text-[#1E7B34] dark:text-green-300">
					{t("hopperFilterSaved")}
				</output>
			)}

			<button
				type="button"
				onClick={handleSave}
				disabled={!canWrite || isPending || !allValid}
				className={cn(dashboardButtonPrimary, "w-full sm:w-auto")}
			>
				{isPending ? t("saving") : t("hopperFilterSave")}
			</button>

			<div className={cn("rounded-xl border p-4", echoTone)}>
				<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-300">
					{t("hopperFilterEchoTitle")}
				</p>
				<p className="mt-1 text-sm font-medium text-[#0A3D62] dark:text-gray-100">{echoSummary}</p>
				{report.available && report.reportedRev !== null && (
					<p className="mt-1 text-[11px] font-medium text-[#3D5568] dark:text-gray-400">
						{t("hopperFilterEchoRevision", {
							rev: report.reportedRev,
							source: report.configSource ?? t("hopperFilterEchoSourceUnknown"),
						})}
					</p>
				)}
				{report.changedAtLabel && (
					<p className="mt-1 text-[11px] font-medium text-[#3D5568] dark:text-gray-400">
						{t("hopperFilterEchoChanged", { when: report.changedAtLabel })}
					</p>
				)}
			</div>
		</div>
	);
}

/** One string for the dirty comparison; order comes from the server's field list. */
function shownKey(
	inputs: Record<HopperFilterKey, string>,
	fields: readonly HopperFilterFieldSpec[],
): string {
	return fields.map((field) => inputs[field.id]).join("|");
}
