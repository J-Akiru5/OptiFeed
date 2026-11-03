"use client";

import { cn } from "@/lib/utils";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Shared date range for charts (#629).
 *
 * The range is a client concern: the server sends a window of rows and the
 * provider filters them without a round trip. A chart only has to pass a
 * `getDate` accessor to `filterByRange` (or use `useChartRange` directly), so
 * one control on the page moves every temporal chart together.
 *
 * A page that also wants the *query* to follow the range (the superadmin
 * command center) controls the provider with `value`/`onChange` and stores the
 * preset in the URL: the preset re-runs the server read, and a custom window
 * narrows whatever window that read returned (#707).
 */

export const CHART_RANGES = ["7d", "30d", "90d", "custom"] as const;
export type ChartRangeKey = (typeof CHART_RANGES)[number];

export type ChartRange = {
	key: ChartRangeKey;
	/** Inclusive custom start, when `key === "custom"`. */
	from: Date | null;
	/** Inclusive custom end, when `key === "custom"`. */
	to: Date | null;
};

export const DEFAULT_CHART_RANGE: ChartRange = { key: "90d", from: null, to: null };

export interface ChartRangeLabels {
	/** Group name, e.g. "Date range". */
	label: string;
	sevenDays: string;
	thirtyDays: string;
	ninetyDays: string;
	custom: string;
	from: string;
	to: string;
}

type ChartRangeContextValue = {
	range: ChartRange;
	setRange: (range: ChartRange) => void;
	/** Anchor the relative presets are measured from; `undefined` = now. */
	now?: Date;
};

const ChartRangeContext = createContext<ChartRangeContextValue | null>(null);

/**
 * Holds the page's shared range.
 *
 * Uncontrolled by default: `initial` seeds `useState`, which is all a page that
 * only filters rows client-side needs. Pass `value` + `onChange` to lift the
 * range out of the provider — the superadmin command center does that to
 * persist the preset in `?range=`, so the *query* re-runs as well as the plot.
 */
export function ChartRangeProvider({
	initial = DEFAULT_CHART_RANGE,
	value,
	onChange,
	now,
	children,
}: {
	initial?: ChartRange;
	/** Controlled range. When supplied the provider never owns the state. */
	value?: ChartRange;
	/** Called on every requested change, controlled or not. */
	onChange?: (range: ChartRange) => void;
	/**
	 * Anchor for the relative presets, normally the last bucket the server
	 * returned. Without it the reader's clock decides the window, which can drop
	 * the newest bucket when the browser is behind the server's day boundary.
	 */
	now?: Date;
	children: ReactNode;
}) {
	const [ownRange, setOwnRange] = useState<ChartRange>(initial);
	const range = value ?? ownRange;
	const setRange = useCallback(
		(next: ChartRange) => {
			if (value === undefined) setOwnRange(next);
			onChange?.(next);
		},
		[value, onChange],
	);
	const context = useMemo(() => ({ range, setRange, now }), [range, setRange, now]);
	return <ChartRangeContext.Provider value={context}>{children}</ChartRangeContext.Provider>;
}

/** The page's current range, or null outside a provider. */
export function useChartRange(): ChartRangeContextValue | null {
	return useContext(ChartRangeContext);
}

const PRESET_DAYS: Record<Exclude<ChartRangeKey, "custom">, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
};

/** Inclusive start of the range, in local time. */
export function rangeStart(range: ChartRange, now = new Date()): Date | null {
	if (range.key === "custom") return range.from ? startOfDay(range.from) : null;
	const start = new Date(now);
	start.setDate(start.getDate() - (PRESET_DAYS[range.key] - 1));
	return startOfDay(start);
}

/** Inclusive end of the range, in local time. */
export function rangeEnd(range: ChartRange, now = new Date()): Date {
	if (range.key === "custom" && range.to) return endOfDay(range.to);
	return endOfDay(now);
}

function startOfDay(date: Date): Date {
	const copy = new Date(date);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

function endOfDay(date: Date): Date {
	const copy = new Date(date);
	copy.setHours(23, 59, 59, 999);
	return copy;
}

/**
 * Parse a row's date. A date-only label (`2026-11-02`) is a calendar day in the
 * viewer's timezone, not UTC midnight: `new Date("2026-11-02")` is 16:00 on the
 * previous day west of Greenwich, which would silently drop the first day of
 * every range. Anything with a time component keeps its own instant.
 */
function parseRangeDate(value: Date | string): Date | null {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (dateOnly) {
		const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
		return Number.isNaN(date.getTime()) ? null : date;
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True when a row's date falls inside the range. Invalid/missing dates are out. */
export function isInRange(
	value: Date | string | null | undefined,
	range: ChartRange,
	now = new Date(),
): boolean {
	if (value === null || value === undefined) return false;
	const date = parseRangeDate(value);
	if (!date) return false;
	const start = rangeStart(range, now);
	if (start && date < start) return false;
	return date <= rangeEnd(range, now);
}

/** Filter rows by an accessor without mutating them. */
export function filterByRange<T>(
	rows: readonly T[],
	getDate: (row: T) => Date | string | null | undefined,
	range: ChartRange,
	now = new Date(),
): T[] {
	return rows.filter((row) => isInRange(getDate(row), range, now));
}

/**
 * The shared control: 7 / 30 / 90 days and a custom window. Native buttons and
 * date inputs, so it is keyboard reachable without extra key handling.
 */
export function ChartRangeControl({
	labels,
	className,
}: {
	labels: ChartRangeLabels;
	className?: string;
}) {
	const context = useChartRange();
	if (!context) return null;

	const { range, setRange } = context;
	const preset = (key: Exclude<ChartRangeKey, "custom">, label: string) => (
		<button
			key={key}
			type="button"
			aria-pressed={range.key === key}
			onClick={() => setRange({ key, from: null, to: null })}
			className={cn(
				"min-h-9 rounded-lg px-3 text-xs font-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
				range.key === key
					? "bg-[#0A3D62] text-white dark:bg-[#8fc0ea] dark:text-[#0A2E47]"
					: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-slate-400 dark:hover:bg-gray-800",
			)}
		>
			{label}
		</button>
	);

	const custom = range.key === "custom";

	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			<span className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-slate-400">
				{labels.label}
			</span>
			<fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
				<legend className="sr-only">{labels.label}</legend>
				{preset("7d", labels.sevenDays)}
				{preset("30d", labels.thirtyDays)}
				{preset("90d", labels.ninetyDays)}
				<button
					type="button"
					aria-pressed={custom}
					onClick={() =>
						setRange({
							key: "custom",
							from: range.from ?? rangeStart(DEFAULT_CHART_RANGE) ?? null,
							to: range.to ?? new Date(),
						})
					}
					className={cn(
						"min-h-9 rounded-lg px-3 text-xs font-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
						custom
							? "bg-[#0A3D62] text-white dark:bg-[#8fc0ea] dark:text-[#0A2E47]"
							: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-slate-400 dark:hover:bg-gray-800",
					)}
				>
					{labels.custom}
				</button>
			</fieldset>

			{custom ? (
				<div className="flex flex-wrap items-center gap-2">
					<label className="flex items-center gap-1 text-[11px] font-bold text-[#3D5568] dark:text-slate-400">
						{labels.from}
						<input
							type="date"
							value={toDateInput(range.from)}
							max={toDateInput(range.to)}
							onChange={(event) =>
								setRange({ ...range, key: "custom", from: parseDateInput(event.target.value) })
							}
							className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100 dark:[color-scheme:dark]"
						/>
					</label>
					<label className="flex items-center gap-1 text-[11px] font-bold text-[#3D5568] dark:text-slate-400">
						{labels.to}
						<input
							type="date"
							value={toDateInput(range.to)}
							min={toDateInput(range.from)}
							onChange={(event) =>
								setRange({ ...range, key: "custom", to: parseDateInput(event.target.value) })
							}
							className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-[#0A3D62] dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100 dark:[color-scheme:dark]"
						/>
					</label>
				</div>
			) : null}
		</div>
	);
}

function toDateInput(date: Date | null): string {
	if (!date) return "";
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
	if (!value) return null;
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return null;
	return new Date(year, month - 1, day);
}
