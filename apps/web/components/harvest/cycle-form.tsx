"use client";

import { useRouter } from "@/i18n/routing";
import { createCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { addDays, daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleInput } from "@/lib/crop-cycle/schema";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { type GrowthTargetResolution, cycleTargetConflict } from "@/lib/growth-target";
import {
	MAX_GROW_OUT_DAYS,
	MIN_GROW_OUT_DAYS,
	type ResolvedGrowthDefault,
	type ResolvedGrowthDefaults,
	SYSTEM_GROWTH_DEFAULTS,
	resolveGrowthDefaults,
} from "@/lib/growth/defaults";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Modal } from "./modal";

interface CycleFormProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	ponds: PondOption[];
	initialPondId: string;
	cycle?: CropCycleDto | null;
}

function optionalNumber(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whole grow-out days from a raw input value. `null` while the field is empty
 * (#825) so clearing it never coerces to `0`; the saved span still comes from
 * the date pair.
 */
function parseGrowOutDays(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Math.round(Number(value));
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The documented constants, resolved through the same helper the server uses
 * (#828). `resolveGrowthDefaults(null, null)` is the pond override → farm
 * default → constant chain with both configurable layers absent.
 */
const SYSTEM_RESOLVED = resolveGrowthDefaults(null, null);

/** Resolved defaults for a pond, or the constants when the payload is old. */
function growthDefaultsForPond(ponds: PondOption[], pondId: string): ResolvedGrowthDefaults {
	return ponds.find((pond) => pond.id === pondId)?.growthDefaults ?? SYSTEM_RESOLVED;
}

/** A usable whole-day default, never `NaN` and never outside the global rails. */
function growOutDaysDefault(defaults: ResolvedGrowthDefaults): number {
	const value = defaults.growOutDays.value;
	return value !== null &&
		Number.isInteger(value) &&
		value >= MIN_GROW_OUT_DAYS &&
		value <= MAX_GROW_OUT_DAYS
		? value
		: SYSTEM_GROWTH_DEFAULTS.growOutDays;
}

/** Whole days from `start` to `end`, or `null` when either date is unusable. */
function growOutSpan(start: string, end: string): number | null {
	if (!isValidDateOnly(start) || !isValidDateOnly(end)) return null;
	return daysBetween(start, end);
}

/**
 * #826: the grow-out period a date pair can actually save. Both actions
 * recompute `growOutDays` from the dates (`crop-cycle.ts` create/update), so a
 * negative or >365 span is not representable — `null` means "keep the last
 * usable period / fall back to the default".
 */
function usableGrowOutSpan(start: string, end: string): number | null {
	const span = growOutSpan(start, end);
	return span === null || span < MIN_GROW_OUT_DAYS || span > MAX_GROW_OUT_DAYS ? null : span;
}

/**
 * #826 (owner decision 4): a saved `null` means "not set" and must render
 * empty, so a later save cannot resurrect the old global literal. New cycles
 * still start from that literal until per-farm defaults land (#828).
 */
function numberField(value: number | null | undefined, fallback: string): string {
	return value === null || value === undefined ? fallback : String(value);
}

/** Which layer supplied a new cycle's default (#828): pond, farm or system. */
function DefaultSourceBadge({ label }: { label: string }) {
	return (
		<span className="ml-1.5 inline-flex rounded-full bg-[#0A3D62]/10 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#9cc7f0]">
			{label}
		</span>
	);
}

export function CycleForm({ open, onClose, onSaved, ponds, initialPondId, cycle }: CycleFormProps) {
	const t = useTranslations("dashboard.harvest.cycleForm");
	const router = useRouter();
	const today = todayDateOnly();
	const initialDefaults = growthDefaultsForPond(ponds, cycle?.pondId ?? initialPondId);
	const initialGrowOutDays = cycle?.growOutDays ?? growOutDaysDefault(initialDefaults);
	const [pondId, setPondId] = useState(cycle?.pondId ?? initialPondId);
	const [label, setLabel] = useState(cycle?.label ?? "");
	const [stockingDate, setStockingDate] = useState(cycle?.stockingDate ?? today);
	const [stockingCount, setStockingCount] = useState(
		String(
			cycle?.stockingCount ?? ponds.find((pond) => pond.id === initialPondId)?.population ?? "",
		),
	);
	const [stockingAvgWeightG, setStockingAvgWeightG] = useState(
		cycle?.stockingAvgWeightG
			? String(cycle.stockingAvgWeightG)
			: numberField(initialDefaults.stockingAvgWeightG.value, ""),
	);
	// Raw input text, not a number: an emptied field must stay empty (#825).
	const [growOutDays, setGrowOutDays] = useState(String(initialGrowOutDays));
	const [targetHarvestDate, setTargetHarvestDate] = useState(
		cycle?.targetHarvestDate ?? addDays(today, initialGrowOutDays),
	);
	const [targetHarvestWeightG, setTargetHarvestWeightG] = useState(
		numberField(
			cycle?.targetHarvestWeightG,
			cycle ? "" : numberField(initialDefaults.targetHarvestWeightG.value, ""),
		),
	);
	const [expectedSurvivalPct, setExpectedSurvivalPct] = useState(
		numberField(
			cycle?.expectedSurvivalPct,
			cycle ? "" : numberField(initialDefaults.expectedSurvivalPct.value, ""),
		),
	);
	const [notes, setNotes] = useState(cycle?.notes ?? "");
	const [error, setError] = useState<string | null>(null);
	/**
	 * Set when saving would overwrite a saved calculator target (D-2). Holds the
	 * saved weight so the confirmation can name both numbers; the input is
	 * rebuilt from the form at confirm time so it cannot go stale.
	 */
	const [pendingSavedWeightG, setPendingSavedWeightG] = useState<number | null>(null);
	const confirmRef = useRef<HTMLDivElement>(null);
	const confirmTitleId = useId();
	const confirmDescId = useId();
	const [isPending, startTransition] = useTransition();
	/**
	 * #825: `DashboardLiveRefresh` re-deserialises the RSC payload every 30 s and
	 * on tab refocus, so `ponds` arrives as a new array while the dialog stays
	 * open. Initialise once per form identity — (cycle, initial pond) — instead
	 * of once per prop identity, and forget it on close so reopening resets.
	 */
	const initialisedFor = useRef<string | null>(null);
	/**
	 * #828: true once the operator changed any agronomic field. Switching pond
	 * inside a new-cycle dialog then refreshes that pond's defaults, but must
	 * never wipe work already typed (#825's rule, applied to pond switching).
	 */
	const touched = useRef(false);
	const lastPondId = useRef(cycle?.pondId ?? initialPondId);
	const markTouched = () => {
		touched.current = true;
	};

	useEffect(() => {
		if (!open) {
			initialisedFor.current = null;
			return;
		}
		const key = `${cycle?.id ?? "new"}:${initialPondId}`;
		if (initialisedFor.current === key) return;
		initialisedFor.current = key;
		const defaults = growthDefaultsForPond(ponds, cycle?.pondId ?? initialPondId);
		const defaultGrowOutDays = cycle?.growOutDays ?? growOutDaysDefault(defaults);
		lastPondId.current = cycle?.pondId ?? initialPondId;
		touched.current = false;
		setPondId(cycle?.pondId ?? initialPondId);
		setLabel(cycle?.label ?? "");
		setStockingDate(cycle?.stockingDate ?? today);
		setStockingCount(
			String(
				cycle?.stockingCount ?? ponds.find((pond) => pond.id === initialPondId)?.population ?? "",
			),
		);
		setStockingAvgWeightG(
			cycle?.stockingAvgWeightG
				? String(cycle.stockingAvgWeightG)
				: numberField(defaults.stockingAvgWeightG.value, ""),
		);
		setGrowOutDays(String(defaultGrowOutDays));
		setTargetHarvestDate(cycle?.targetHarvestDate ?? addDays(today, defaultGrowOutDays));
		setTargetHarvestWeightG(
			numberField(
				cycle?.targetHarvestWeightG,
				cycle ? "" : numberField(defaults.targetHarvestWeightG.value, ""),
			),
		);
		setExpectedSurvivalPct(
			numberField(
				cycle?.expectedSurvivalPct,
				cycle ? "" : numberField(defaults.expectedSurvivalPct.value, ""),
			),
		);
		setNotes(cycle?.notes ?? "");
		setError(null);
		setPendingSavedWeightG(null);
	}, [open, cycle, initialPondId, ponds, today]);

	/**
	 * #828: choosing another pond inside a new-cycle dialog applies that pond's
	 * resolved defaults (and its population). It does nothing once the operator
	 * has typed an agronomic value, or while editing an existing cycle (the
	 * pond selector is disabled there anyway).
	 */
	useEffect(() => {
		if (!open) return;
		if (lastPondId.current === pondId) return;
		lastPondId.current = pondId;
		if (cycle || touched.current) return;

		const pond = ponds.find((candidate) => candidate.id === pondId);
		const defaults = pond?.growthDefaults ?? SYSTEM_RESOLVED;
		const defaultGrowOutDays = growOutDaysDefault(defaults);
		setStockingCount(String(pond?.population ?? ""));
		setStockingAvgWeightG(numberField(defaults.stockingAvgWeightG.value, ""));
		setGrowOutDays(String(defaultGrowOutDays));
		setTargetHarvestWeightG(numberField(defaults.targetHarvestWeightG.value, ""));
		setExpectedSurvivalPct(numberField(defaults.expectedSurvivalPct.value, ""));
		setTargetHarvestDate(
			isValidDateOnly(stockingDate)
				? addDays(stockingDate, defaultGrowOutDays)
				: addDays(today, defaultGrowOutDays),
		);
	}, [open, pondId, cycle, ponds, stockingDate, today]);

	useEffect(() => {
		if (pendingSavedWeightG === null) return;
		// Announce the decision and put the keyboard inside it; Tab reaches
		// the three buttons from here.
		confirmRef.current?.focus();
	}, [pendingSavedWeightG]);

	const span = growOutSpan(stockingDate, targetHarvestDate) ?? 0;
	const dateRangeInvalid = span < MIN_GROW_OUT_DAYS || span > MAX_GROW_OUT_DAYS;
	// #826: `daysBetween` throws on an unusable date, and a cleared date input
	// is a normal state while the operator edits. Treat it as "not future".
	const stockingFuture = isValidDateOnly(stockingDate) && daysBetween(stockingDate, today) < -7;
	const harvestMin = isValidDateOnly(stockingDate)
		? addDays(stockingDate, MIN_GROW_OUT_DAYS)
		: undefined;
	const harvestMax = isValidDateOnly(stockingDate)
		? addDays(stockingDate, MAX_GROW_OUT_DAYS)
		: undefined;
	const projectedKg =
		Number(stockingCount) > 0 && Number(targetHarvestWeightG) > 0
			? (Number(stockingCount) *
					(Math.min(100, Math.max(1, Number(expectedSurvivalPct) || 100)) / 100) *
					Number(targetHarvestWeightG)) /
				1000
			: null;

	const selectedPond = ponds.find((pond) => pond.id === pondId);
	const activeDefaults = growthDefaultsForPond(ponds, pondId);
	const densityAdvisoryPerM2 =
		activeDefaults.densityAdvisoryPerM2.value ?? SYSTEM_GROWTH_DEFAULTS.densityAdvisoryPerM2;
	const savedTargetWeightG = selectedPond?.savedTargetWeightG ?? null;
	const pendingSavedLabel = pendingSavedWeightG === null ? null : pendingSavedWeightG.toFixed(1);
	const pendingNextLabel =
		pendingSavedWeightG === null
			? null
			: (optionalNumber(targetHarvestWeightG)?.toFixed(1) ?? null);
	const areaM2 = selectedPond?.areaM2 ?? null;
	const averageDepthM = selectedPond?.averageDepthM ?? null;
	const stockingCountNumber = Number(stockingCount);
	const densityPerM2 = areaM2 && stockingCountNumber > 0 ? stockingCountNumber / areaM2 : null;
	const densityPerM3 =
		areaM2 && averageDepthM && stockingCountNumber > 0
			? stockingCountNumber / (areaM2 * averageDepthM)
			: null;
	const sourceLabel = (resolved: ResolvedGrowthDefault): string => {
		const key =
			resolved.source === "pond"
				? "sourcePond"
				: resolved.source === "farm"
					? "sourceFarm"
					: "sourceSystem";
		return t(key);
	};

	/**
	 * #826 (owner decision 3): the harvest date is the operator's anchor.
	 * Moving the stocking date re-derives the grow-out period from the pair
	 * instead of shifting the harvest date by the same number of days.
	 */
	const onStockingDateChange = (value: string) => {
		markTouched();
		setStockingDate(value);
		const days = usableGrowOutSpan(value, targetHarvestDate);
		if (days !== null) setGrowOutDays(String(days));
	};

	/**
	 * Typing a usable period still moves the harvest date — that is the job of
	 * this field. An empty or out-of-range entry moves nothing: the harvest
	 * date stays put and the field snaps back to the pair on blur, so it never
	 * shows a value that would not be saved.
	 */
	const onGrowOutDaysChange = (value: string) => {
		markTouched();
		setGrowOutDays(value);
		const days = parseGrowOutDays(value);
		if (
			isValidDateOnly(stockingDate) &&
			days !== null &&
			days >= MIN_GROW_OUT_DAYS &&
			days <= MAX_GROW_OUT_DAYS
		) {
			setTargetHarvestDate(addDays(stockingDate, days));
		}
	};

	/**
	 * #826: an out-of-range pair keeps the last usable period instead of
	 * showing a negative or >365 number. The date-range error stays visible and
	 * blocks the save until one of the dates is corrected.
	 */
	const onHarvestDateChange = (value: string) => {
		markTouched();
		setTargetHarvestDate(value);
		const days = usableGrowOutSpan(stockingDate, value);
		if (days !== null) setGrowOutDays(String(days));
	};

	/**
	 * #826: leave the grow-out field showing exactly what the date pair will
	 * save. An emptied field falls back to the pair, then to the last usable
	 * value, then to the documented default — it never becomes `NaN` and never
	 * builds a date from empty text.
	 */
	const snapGrowOutDays = () => {
		const usable = usableGrowOutSpan(stockingDate, targetHarvestDate);
		if (usable !== null) {
			setGrowOutDays(String(usable));
			return;
		}
		const current = parseGrowOutDays(growOutDays);
		if (current !== null && current >= MIN_GROW_OUT_DAYS && current <= MAX_GROW_OUT_DAYS) {
			setGrowOutDays(String(current));
			return;
		}
		// #828: the last resort is the pond's resolved default (pond → farm →
		// constant), not a global literal.
		setGrowOutDays(String(growOutDaysDefault(activeDefaults)));
	};

	/** Validate the form and return the payload, or show the existing error. */
	const buildInput = (): CropCycleInput | null => {
		setError(null);
		if (!pondId) {
			setError(t("pondRequired"));
			return null;
		}
		if (dateRangeInvalid) {
			setError(t("dateRangeError"));
			return null;
		}
		if (stockingFuture) {
			setError(t("stockingFuture"));
			return null;
		}
		if (!Number.isFinite(Number(stockingCount)) || Number(stockingCount) < 1) {
			setError(t("stockingCountError"));
			return null;
		}

		return {
			pondId,
			label: label.trim() || null,
			stockingDate,
			stockingCount: Math.round(Number(stockingCount)),
			stockingAvgWeightG: optionalNumber(stockingAvgWeightG),
			// #826: the field mirrors this span (the actions recompute it the
			// same way), and `submit` snaps the field to it first, so the value
			// shown is always the value sent.
			growOutDays: span,
			targetHarvestDate,
			targetHarvestWeightG: optionalNumber(targetHarvestWeightG),
			expectedSurvivalPct: optionalNumber(expectedSurvivalPct),
			notes: notes.trim() || null,
		};
	};

	const persist = (input: CropCycleInput, resolution: GrowthTargetResolution | null) => {
		setPendingSavedWeightG(null);
		startTransition(async () => {
			const result = cycle
				? resolution
					? await updateCropCycle(cycle.id, input, { growthTargetResolution: resolution })
					: await updateCropCycle(cycle.id, input)
				: await createCropCycle(input);
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(cycle ? t("successUpdate") : t("successCreate"));
			router.refresh();
			onSaved();
			onClose();
		});
	};

	const submit = () => {
		// #826: commit the displayed grow-out period with the dates it describes.
		snapGrowOutDays();
		const input = buildInput();
		if (!input) return;

		const conflict =
			cycle && savedTargetWeightG !== null
				? cycleTargetConflict({
						savedWeightG: savedTargetWeightG,
						cycleWeightG: cycle.targetHarvestWeightG,
						nextWeightG: input.targetHarvestWeightG ?? null,
					})
				: null;
		if (conflict) {
			// D-2: never let the edit or the saved target win silently.
			setPendingSavedWeightG(conflict.savedWeightG);
			return;
		}

		persist(input, null);
	};

	const resolveTargetConflict = (resolution: GrowthTargetResolution) => {
		const input = buildInput();
		if (!input) {
			setPendingSavedWeightG(null);
			return;
		}
		persist(input, resolution);
	};

	return (
		<Modal
			open={open}
			onClose={isPending ? () => undefined : onClose}
			title={cycle ? t("titleEdit") : t("titleNew")}
			description={t("desc")}
			size="lg"
			footer={
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onClose}
						disabled={isPending}
						className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						onClick={submit}
						disabled={isPending}
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] disabled:opacity-50 dark:bg-[#1f66a0]"
					>
						{isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{isPending ? t("saving") : t("save")}
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("pond")}
						</span>
						<select
							value={pondId}
							onChange={(event) => setPondId(event.target.value)}
							disabled={Boolean(cycle)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						>
							{ponds.map((pond) => (
								<option key={pond.id} value={pond.id}>
									{pond.name}
								</option>
							))}
						</select>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("label")}
						</span>
						<input
							value={label}
							onChange={(event) => setLabel(event.target.value)}
							maxLength={64}
							placeholder={t("labelPlaceholder")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingDate")}
						</span>
						<input
							type="date"
							value={stockingDate}
							onChange={(event) => onStockingDateChange(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingCount")}
						</span>
						<input
							type="number"
							min={1}
							max={1_000_000}
							value={stockingCount}
							onChange={(event) => {
								markTouched();
								setStockingCount(event.target.value);
							}}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<div className="rounded-xl border border-dashed border-[#0A3D62]/15 bg-[#F4F7F6] px-3 py-2 text-xs text-[#3D5568] sm:col-span-2 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
						<span className="font-extrabold uppercase tracking-wider text-gray-500">
							{t("densityLabel")}:
						</span>{" "}
						{densityPerM2 !== null ? (
							<>
								<span className="font-bold">
									{t("densityValue", { density: densityPerM2.toFixed(1) })}
								</span>
								{densityPerM3 !== null && (
									<span> · {t("densityValueDepth", { density: densityPerM3.toFixed(1) })}</span>
								)}
							</>
						) : (
							<span>{t("densityNoArea")}</span>
						)}
						{densityPerM2 !== null && densityPerM2 > densityAdvisoryPerM2 && (
							<span className="ml-1 font-bold text-amber-600">
								{t("densityHigh", { density: densityAdvisoryPerM2 })}
							</span>
						)}
						{!cycle && (
							<span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">
								{t("defaultsHint")}
							</span>
						)}
					</div>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("growOutDays")}
							{!cycle && <DefaultSourceBadge label={sourceLabel(activeDefaults.growOutDays)} />}
						</span>
						<input
							type="number"
							min={MIN_GROW_OUT_DAYS}
							max={MAX_GROW_OUT_DAYS}
							aria-label={t("growOutDays")}
							value={growOutDays}
							onChange={(event) => onGrowOutDaysChange(event.target.value)}
							onBlur={snapGrowOutDays}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("harvestDate")}
						</span>
						<input
							type="date"
							value={targetHarvestDate}
							min={harvestMin}
							max={harvestMax}
							onChange={(event) => onHarvestDateChange(event.target.value)}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("stockingWeight")}
							{!cycle && activeDefaults.stockingAvgWeightG.value !== null && (
								<DefaultSourceBadge label={sourceLabel(activeDefaults.stockingAvgWeightG)} />
							)}
						</span>
						<input
							type="number"
							min={0}
							step="0.1"
							aria-label={t("stockingWeight")}
							value={stockingAvgWeightG}
							onChange={(event) => {
								markTouched();
								setStockingAvgWeightG(event.target.value);
							}}
							placeholder={t("optional")}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("targetWeight")}
							{!cycle && (
								<DefaultSourceBadge label={sourceLabel(activeDefaults.targetHarvestWeightG)} />
							)}
						</span>
						<input
							type="number"
							min={1}
							step="1"
							aria-label={t("targetWeight")}
							value={targetHarvestWeightG}
							onChange={(event) => {
								markTouched();
								setTargetHarvestWeightG(event.target.value);
							}}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
							{t("survival")}
							{!cycle && (
								<DefaultSourceBadge label={sourceLabel(activeDefaults.expectedSurvivalPct)} />
							)}
						</span>
						<input
							type="number"
							min={1}
							max={100}
							step="1"
							aria-label={t("survival")}
							value={expectedSurvivalPct}
							onChange={(event) => {
								markTouched();
								setExpectedSurvivalPct(event.target.value);
							}}
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-semibold text-[#0A3D62] focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
						/>
					</label>
				</div>

				<label className="block">
					<span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("notes")}
					</span>
					<textarea
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						rows={3}
						maxLength={1_000}
						placeholder={t("notesPlaceholder")}
						className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2.5 text-sm font-medium text-[#0A3D62] placeholder:text-gray-400 focus:border-[#E85A2A] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
					/>
				</label>

				<div className="rounded-2xl border border-[#0A3D62]/10 bg-[#0A3D62]/[0.03] p-3 dark:border-white/10 dark:bg-white/5">
					<p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
						{t("projected")}
					</p>
					<p className="mt-1 text-xl font-black text-[#0A3D62] dark:text-[#9cc7f0]">
						{projectedKg !== null ? `${projectedKg.toFixed(1)} kg` : "—"}
					</p>
					<p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
						{t("projectedHint")}
					</p>
				</div>

				{(dateRangeInvalid || stockingFuture) && (
					<p className="text-xs font-semibold text-red-600 dark:text-red-400">
						{stockingFuture ? t("stockingFuture") : t("dateRangeError")}
					</p>
				)}
				{error && (
					<p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
						{error}
					</p>
				)}

				{pendingSavedWeightG !== null && pendingSavedLabel !== null && (
					<div
						ref={confirmRef}
						role="alertdialog"
						aria-labelledby={confirmTitleId}
						aria-describedby={confirmDescId}
						tabIndex={-1}
						onKeyDown={(event) => {
							if (event.key !== "Escape") return;
							event.stopPropagation();
							setPendingSavedWeightG(null);
						}}
						className="rounded-2xl border border-amber-300 bg-amber-50 p-4 outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-900/50 dark:bg-amber-950/30"
					>
						<p
							id={confirmTitleId}
							className="text-sm font-black text-amber-900 dark:text-amber-200"
						>
							{t("targetConflictTitle")}
						</p>
						<p
							id={confirmDescId}
							className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200"
						>
							{pendingNextLabel !== null
								? t("targetConflictDesc", {
										saved: pendingSavedLabel,
										next: pendingNextLabel,
									})
								: t("targetConflictDescEmpty", { saved: pendingSavedLabel })}
						</p>
						<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
							<button
								type="button"
								onClick={() => resolveTargetConflict("replace")}
								disabled={isPending}
								className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0A3D62] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#164e7c] disabled:opacity-50 dark:bg-[#1f66a0] dark:hover:bg-[#2a7ab5]"
							>
								{t("targetConflictReplace")}
							</button>
							<button
								type="button"
								onClick={() => resolveTargetConflict("keep")}
								disabled={isPending}
								className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#0A3D62]/30 bg-white px-3 py-2 text-xs font-bold text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/5 disabled:opacity-50 dark:border-white/20 dark:bg-gray-900 dark:text-blue-200 dark:hover:bg-white/5"
							>
								{t("targetConflictKeep")}
							</button>
							<button
								type="button"
								onClick={() => setPendingSavedWeightG(null)}
								disabled={isPending}
								className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/10"
							>
								{t("targetConflictCancel")}
							</button>
						</div>
						<p className="mt-2 text-[11px] font-medium text-amber-800 dark:text-amber-200/90">
							{pendingNextLabel !== null
								? t("targetConflictReplaceHint", { next: pendingNextLabel })
								: t("targetConflictReplaceClearHint")}
						</p>
						<p className="text-[11px] font-medium text-amber-800 dark:text-amber-200/90">
							{t("targetConflictKeepHint", { saved: pendingSavedLabel })}
						</p>
					</div>
				)}
			</div>
		</Modal>
	);
}
