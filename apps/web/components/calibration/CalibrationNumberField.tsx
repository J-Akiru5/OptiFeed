"use client";

import {
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * One numeric-input pattern for every calibration field on the hardware page.
 *
 * The value is a string, not a number: a controlled `number` input whose state
 * is a number cannot be cleared (`Number("") === 0` puts the zero straight back)
 * and it cannot hold the intermediate text a person types. Parsing happens on
 * submit through `parseCalibrationNumber`, so an empty or malformed field is
 * rejected instead of silently becoming 0 (issue #307).
 */

export interface CalibrationNumberRules {
	/** Inclusive lower bound; also the input's `min`. */
	min: number;
	/** Inclusive upper bound; also the input's `max`. */
	max: number;
	/**
	 * Maximum accepted decimal places. 0 means whole units (centimetres,
	 * seconds, days); 1 is a weighed gram value; 2 covers rates and offsets that
	 * the server stores with two decimals.
	 */
	decimals?: 0 | 1 | 2;
	/** Stepper increment. Defaults to 1 for whole units and 0.1 otherwise. */
	step?: number;
}

export type CalibrationNumberParse =
	| { status: "empty" }
	| { status: "valid"; value: number }
	| { status: "invalid"; reason: "format" | "range" | "precision" };

const NUMBER_PATTERN = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/** `4` → 4, `4.25` → 4.25, `abc` → invalid, `1.234` cm → precision error. */
export function parseCalibrationNumber(
	raw: string,
	rules: CalibrationNumberRules,
): CalibrationNumberParse {
	const text = raw.trim();
	if (text === "") return { status: "empty" };
	if (!NUMBER_PATTERN.test(text)) return { status: "invalid", reason: "format" };

	const value = Number(text.replace(",", "."));
	if (!Number.isFinite(value)) return { status: "invalid", reason: "format" };
	if (value < rules.min || value > rules.max) return { status: "invalid", reason: "range" };

	const decimals = rules.decimals ?? 0;
	const scale = 10 ** decimals;
	if (Math.abs(value * scale - Math.round(value * scale)) > 1e-9) {
		return { status: "invalid", reason: "precision" };
	}

	return { status: "valid", value };
}

/**
 * The next value for a stepper press. An empty field starts one step inside the
 * range (never at a wild default such as the temperature maximum) and every
 * result is clamped and rounded, so + and - always land on the same precision
 * the field accepts.
 */
export function stepCalibrationNumber(
	raw: string,
	direction: 1 | -1,
	rules: CalibrationNumberRules,
): string {
	const decimals = rules.decimals ?? 0;
	const step = rules.step ?? (decimals === 0 ? 1 : 0.1);
	const parsed = parseCalibrationNumber(raw, rules);
	const base = parsed.status === "valid" ? parsed.value : direction > 0 ? rules.min : rules.max;
	const next = Math.min(rules.max, Math.max(rules.min, base + direction * step));
	return String(Number(next.toFixed(decimals)));
}

/** Responsive three-column field grid: 1 column on phones, 2 on tablets, 3 on desktop. */
export const calibrationFieldGrid = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

interface CalibrationNumberFieldProps extends CalibrationNumberRules {
	id: string;
	label: string;
	/** Suffix shown inside the field, e.g. `cm`, `g`, `g/s`, `°C`. */
	unit: string;
	value: string;
	onValueChange: (next: string) => void;
	/** Help text under the field. Referenced by `aria-describedby`. */
	help?: string;
	/** Placeholder shown while the field is empty. */
	placeholder?: string;
	/** Extra error (for example a cross-field rule) that outranks validation. */
	error?: string;
	disabled?: boolean;
	className?: string;
}

export function CalibrationNumberField({
	id,
	label,
	unit,
	value,
	onValueChange,
	help,
	placeholder,
	error,
	disabled = false,
	className,
	min,
	max,
	decimals = 0,
	step,
}: CalibrationNumberFieldProps) {
	const t = useTranslations("dashboard.appSettings.calibration.numberField");
	const rules: CalibrationNumberRules = { min, max, decimals, step };
	const parsed = parseCalibrationNumber(value, rules);

	let validationError: string | null = null;
	if (parsed.status === "invalid") {
		if (parsed.reason === "range") {
			validationError = t("range", { min, max });
		} else if (parsed.reason === "precision") {
			validationError = decimals === 0 ? t("wholeNumber") : t("decimalPlaces", { decimals });
		} else {
			validationError = t("format");
		}
	}

	const shownError = error ?? validationError;
	const helpId = `${id}-help`;
	const errorId = `${id}-error`;
	const describedBy =
		[help ? helpId : null, shownError ? errorId : null].filter(Boolean).join(" ") || undefined;
	const stepValue = step ?? (decimals === 0 ? 1 : 0.1);
	const buttonClass =
		"inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:focus-visible:outline-[#8fc0ea]";

	return (
		<div className={cn("min-w-0", className)}>
			<label htmlFor={id} className={dashboardLabel}>
				{label}
			</label>
			<div className="flex items-stretch gap-1.5">
				<button
					type="button"
					aria-label={t("decrease", { label })}
					aria-controls={id}
					onClick={() => onValueChange(stepCalibrationNumber(value, -1, rules))}
					disabled={disabled}
					className={buttonClass}
				>
					<Minus className="h-4 w-4" aria-hidden="true" />
				</button>

				<div className="relative min-w-0 flex-1">
					<input
						id={id}
						type="number"
						min={min}
						max={max}
						step={stepValue}
						inputMode={decimals === 0 ? "numeric" : "decimal"}
						value={value}
						onChange={(event) => onValueChange(event.target.value)}
						placeholder={placeholder}
						disabled={disabled}
						aria-invalid={shownError ? true : undefined}
						aria-describedby={describedBy}
						className={cn(
							dashboardField,
							"pr-14 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
							shownError && "border-[#C42B3A] focus-visible:ring-[#C42B3A] dark:border-red-400",
						)}
					/>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400"
					>
						{unit}
					</span>
				</div>

				<button
					type="button"
					aria-label={t("increase", { label })}
					aria-controls={id}
					onClick={() => onValueChange(stepCalibrationNumber(value, 1, rules))}
					disabled={disabled}
					className={buttonClass}
				>
					<Plus className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>

			{help && (
				<p id={helpId} className={dashboardHint}>
					{help}
				</p>
			)}
			{shownError && (
				<p
					id={errorId}
					role="alert"
					className="mt-1 text-xs font-medium text-[#C42B3A] dark:text-red-300"
				>
					{shownError}
				</p>
			)}
		</div>
	);
}
