"use client";

import {
	dashboardButtonPrimary,
	dashboardField,
	dashboardHint,
	dashboardLabel,
} from "@/components/dashboard/dashboard-classes";
import { mobileStickyActions } from "@/components/mobile/form-actions";
import { Link, useRouter } from "@/i18n/routing";
import {
	discardPondSettingsDraft,
	loadPondSettingsDraft,
	savePondSettingsDraft,
} from "@/lib/actions/pond-draft";
import { updateDeviceDailyCap, updatePondSettings } from "@/lib/actions/settings";
import { formatFarmDateTime } from "@/lib/date-local";
import { requestHelpTarget } from "@/lib/help/reveal";
import { MAX_FEED_GRAMS_PER_DAY_PER_DEVICE } from "@/lib/limits-core";
import {
	POND_SETTINGS_ERROR_KEYS,
	type PondDeviceConflict,
	type PondDeviceConstraints,
	type PondSettingsFieldError,
	buildPondFeedPreview,
	detectPondDeviceConflicts,
} from "@/lib/settings/pond-conflicts";
import {
	clearPondDraft,
	readPondDraft,
	sessionStorageOrNull,
	writePondDraft,
} from "@/lib/settings/pond-draft";
import {
	POND_SETTINGS_FIELDS,
	type PondSettingsField,
	pondFieldSpec,
} from "@/lib/settings/pond-fields";
import { type PondSettingsDraft, parsePondSettingsDraft } from "@/lib/settings/pond-input";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	Loader2,
	RotateCcw,
	SlidersHorizontal,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";

interface PondSettingsFormProps {
	pond: {
		id: string;
		feedingRatePct: number;
		feedsPerDay: number;
		sampleIntervalDays: number;
		population: number | null;
		areaM2: number | null;
		averageDepthM: number | null;
		feedPricePerKg: number | null;
	};
	canWrite?: boolean;
	/** Latest sampled average body weight (kg); null when there is no sample. */
	avgWeightKg?: number | null;
	/** The active feeder's effective limits, for the live derived preview. */
	device?: PondDeviceConstraints | null;
	/**
	 * The per-meal dose the *saved* pond settings already ask for (#430).
	 *
	 * When that dose is already over the feeder's relay window, the conflict is
	 * not the reader's doing, and the card has to say so — otherwise a plan that
	 * went stale looks like the reader's mistake.
	 */
	savedPerMealG?: number | null;
}

const FIELD_KEYS: Record<PondSettingsField, keyof PondSettingsDraft> = {
	feedingRatePct: "feedingRate",
	feedsPerDay: "feedsPerDay",
	sampleIntervalDays: "sampleInterval",
	population: "population",
	areaM2: "areaM2",
	averageDepthM: "averageDepthM",
	feedPricePerKg: "feedPricePerKg",
};

const HINT_KEYS: Record<PondSettingsField, string> = {
	feedingRatePct: "rateDesc",
	feedsPerDay: "freqDesc",
	sampleIntervalDays: "sampleIntervalDesc",
	population: "populationDesc",
	areaM2: "areaDesc",
	averageDepthM: "depthDesc",
	feedPricePerKg: "feedPriceDesc",
};

const PLACEHOLDER_KEYS: Partial<Record<PondSettingsField, string>> = {
	population: "populationPlaceholder",
	areaM2: "areaPlaceholder",
	averageDepthM: "depthPlaceholder",
	feedPricePerKg: "feedPricePlaceholder",
};

const INPUT_PROPS: Record<
	PondSettingsField,
	{
		type: "number";
		min?: string;
		max?: string;
		step?: string;
		inputMode: "numeric" | "decimal";
		required?: boolean;
	}
> = {
	feedingRatePct: {
		type: "number",
		step: "0.1",
		min: "0.1",
		max: "10",
		inputMode: "decimal",
		required: true,
	},
	feedsPerDay: { type: "number", min: "1", max: "24", inputMode: "numeric", required: true },
	sampleIntervalDays: { type: "number", min: "1", max: "90", inputMode: "numeric", required: true },
	population: { type: "number", min: "1", inputMode: "numeric" },
	areaM2: { type: "number", min: "0", step: "0.1", inputMode: "decimal" },
	averageDepthM: { type: "number", min: "0", step: "0.1", inputMode: "decimal" },
	feedPricePerKg: { type: "number", min: "0", step: "0.01", inputMode: "decimal" },
};

function initialDraft(pond: PondSettingsFormProps["pond"]): PondSettingsDraft {
	return {
		feedingRate: pond.feedingRatePct.toString(),
		feedsPerDay: pond.feedsPerDay.toString(),
		sampleInterval: pond.sampleIntervalDays.toString(),
		population: pond.population?.toString() ?? "",
		areaM2: pond.areaM2?.toString() ?? "",
		averageDepthM: pond.averageDepthM?.toString() ?? "",
		feedPricePerKg: pond.feedPricePerKg?.toString() ?? "",
	};
}

/**
 * How long the form waits after the last keystroke before writing the database
 * draft (I-99). One write per pause, never one per character.
 */
const POND_DRAFT_SAVE_DEBOUNCE_MS = 800;

/**
 * Pond settings (#371).
 *
 * Two rules shape this form:
 *
 *  1. Never lose what the reader typed. The values live in one controlled draft,
 *     a failed save leaves it untouched, and the unsaved draft follows the
 *     reader to another device or after the browser is closed: since I-99 it is
 *     stored in the database per pond and user (debounced), with
 *     `sessionStorage` as the offline fallback. A draft is restored only when
 *     it is newer than the saved settings and actually differs from them, and
 *     it is cleared after a successful save.
 *  2. Say exactly what is wrong and where. Parse and server errors render under
 *     their field and in a summary whose links move focus to that field. A
 *     conflict with the feeder's limits renders as a card that names the pond
 *     value, the device value and the exact device setting, because the pond
 *     setting is the source of truth.
 */
export function PondSettingsForm({
	pond,
	canWrite = true,
	avgWeightKg = null,
	device = null,
	savedPerMealG = null,
}: PondSettingsFormProps) {
	const t = useTranslations("dashboard.settings");
	const tDates = useTranslations("dates");
	const locale = useLocale();
	const router = useRouter();
	const summaryId = useId();
	const [draft, setDraft] = useState<PondSettingsDraft>(() => initialDraft(pond));
	const [dirty, setDirty] = useState(false);
	const [restored, setRestored] = useState(false);
	const [restoredAt, setRestoredAt] = useState<string | null>(null);
	const [hydrated, setHydrated] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<PondSettingsFieldError[]>([]);
	const [serverError, setServerError] = useState<string | null>(null);
	const [appliedCeilingG, setAppliedCeilingG] = useState<number | null>(null);
	const [isPending, startTransition] = useTransition();
	const [success, setSuccess] = useState(false);

	// The "saved" banner clears itself; the cleanup cancels the timer on unmount
	// so it never sets state on a form that is already gone.
	useEffect(() => {
		if (!success) return;
		const timer = window.setTimeout(() => setSuccess(false), 3000);
		return () => window.clearTimeout(timer);
	}, [success]);

	// Bring back an unsaved draft once per mount (I-99). The database copy is
	// the real one — it survives a closed browser and is scoped to this pond and
	// this user. `sessionStorage` is only the offline fallback: it is used when
	// the action cannot be reached, or when it answers but the database holds no
	// draft (the last save happened while offline). A database draft always wins.
	useEffect(() => {
		let cancelled = false;

		// A VIEWER cannot save, so there is no draft worth restoring; skip the
		// call instead of provoking a rejected guard on every read-only visit.
		if (!canWrite) {
			setHydrated(true);
			return;
		}

		const restore = async () => {
			let fromDatabase: { values: PondSettingsDraft; updatedAt: string } | null = null;
			try {
				const result = await loadPondSettingsDraft(pond.id);
				if (cancelled) return;
				if (result.success && result.draft) {
					fromDatabase = result.draft;
				}
			} catch {
				// Offline or the action failed: fall through to the local copy.
			}
			if (cancelled) return;

			if (fromDatabase) {
				setDraft(fromDatabase.values);
				setRestored(true);
				setRestoredAt(fromDatabase.updatedAt);
				clearPondDraft(sessionStorageOrNull(), pond.id);
				setHydrated(true);
				return;
			}

			const stored = readPondDraft(sessionStorageOrNull(), pond.id);
			if (stored) {
				setDraft(stored);
				setRestored(true);
				setRestoredAt(null);
				// Push the local copy to the database on the next debounce, so a
				// draft typed while offline becomes durable once the link is back.
				setDirty(true);
			}
			setHydrated(true);
		};

		void restore();
		return () => {
			cancelled = true;
		};
	}, [canWrite, pond.id]);

	// Persist while the reader edits, never the pristine values (that would show
	// "restored" on every visit). The write is debounced so a typing burst costs
	// one action call; a failed call keeps the values in sessionStorage.
	useEffect(() => {
		if (!dirty || !hydrated || !canWrite) return;

		const values = draft;
		const timer = window.setTimeout(() => {
			void (async () => {
				try {
					const result = await savePondSettingsDraft(pond.id, values);
					if (result.success) {
						// The database is authoritative again; drop the offline copy.
						clearPondDraft(sessionStorageOrNull(), pond.id);
						return;
					}
				} catch {
					// Offline: keep the local fallback below.
				}
				writePondDraft(sessionStorageOrNull(), pond.id, values);
			})();
		}, POND_DRAFT_SAVE_DEBOUNCE_MS);

		return () => window.clearTimeout(timer);
	}, [dirty, hydrated, draft, pond.id, canWrite]);

	const parsed = parsePondSettingsDraft(draft);
	const preview = buildPondFeedPreview({
		population: parsed.ok ? parsed.values.population : null,
		avgWeightKg,
		feedingRatePct: parsed.ok ? parsed.values.feedingRatePct : Number.NaN,
		feedsPerDay: parsed.ok ? parsed.values.feedsPerDay : Number.NaN,
	});
	const conflicts = device ? detectPondDeviceConflicts(preview, device) : [];
	const visibleConflicts = conflicts.filter(
		(conflict) =>
			conflict.code !== "daily-ceiling" ||
			appliedCeilingG === null ||
			appliedCeilingG < conflict.pondValueG,
	);

	const gramFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
	const densityFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
	const grams = (value: number) => `${gramFormat.format(Math.round(value))} g`;

	const population = Number.parseInt(draft.population, 10);
	const area = Number.parseFloat(draft.areaM2);
	const density =
		Number.isFinite(population) && population > 0 && Number.isFinite(area) && area > 0
			? densityFormat.format(population / area)
			: null;

	// The biggest dose this feeder can run in one relay window (#430).
	const deviceMaxDoseG =
		device && device.gramsPerSecond > 0
			? device.gramsPerSecond * (device.maxDispenseMs / 1000)
			: null;
	// True when the *saved* plan already asked for more than the feeder can run,
	// so the conflict on screen is not the reader's doing.
	const savedPlanAlreadyOver =
		savedPerMealG !== null && deviceMaxDoseG !== null && savedPerMealG > deviceMaxDoseG;

	const conflictTitle = (conflict: PondDeviceConflict) => {
		switch (conflict.code) {
			case "daily-ceiling":
				return t("conflicts.dailyTitle");
			case "relay-time":
				return t("conflicts.relayTitle");
		}
	};

	const conflictMessage = (conflict: PondDeviceConflict) => {
		const values = { pond: grams(conflict.pondValueG), device: grams(conflict.deviceValueG) };
		switch (conflict.code) {
			case "daily-ceiling":
				return t("errors.deviceDailyCeiling", values);
			case "relay-time":
				return t("errors.deviceRelayTime", values);
		}
	};

	const conflictReason = (conflict: PondDeviceConflict) => {
		if (conflict.code !== "daily-ceiling") return null;
		if (conflict.aboveHardMax) {
			return t("conflicts.aboveHardMax", { max: grams(MAX_FEED_GRAMS_PER_DAY_PER_DEVICE) });
		}
		if (device?.dailyCapSource === "platform") return t("conflicts.platformCap");
		if (device?.dailyCapSource === "hopper") return t("conflicts.hopperCap");
		return null;
	};

	const focusField = (field: PondSettingsField) => {
		const element = document.getElementById(pondFieldSpec(field).inputId);
		if (element instanceof HTMLElement) {
			if (typeof element.scrollIntoView === "function") {
				element.scrollIntoView({ block: "center", behavior: "auto" });
			}
			element.focus({ preventScroll: true });
		}
	};

	const update = (key: keyof PondSettingsDraft, value: string) => {
		setDraft((current) => ({ ...current, [key]: value }));
		setDirty(true);
		setSuccess(false);
		setServerError(null);
		// Legacy server errors belong to the previous submission; the live
		// summary below replaces them as soon as the reader edits.
		setFieldErrors([]);
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setSuccess(false);
		setServerError(null);

		const result = parsePondSettingsDraft(draft);
		if (!result.ok) {
			setFieldErrors(result.errors);
			const first = result.errors[0];
			if (first) requestAnimationFrame(() => focusField(first.field));
			return;
		}
		const values = result.values;

		startTransition(async () => {
			const response = await updatePondSettings(
				pond.id,
				values.feedingRatePct,
				values.feedsPerDay,
				values.sampleIntervalDays,
				values.population,
				{
					areaM2: values.areaM2,
					averageDepthM: values.averageDepthM,
					feedPricePerKg: values.feedPricePerKg,
				},
			);
			if (response.success) {
				clearPondDraft(sessionStorageOrNull(), pond.id);
				// Best effort: even if a late debounced write re-creates the row, a
				// draft that matches the saved values is ignored on load.
				void discardPondSettingsDraft(pond.id).catch(() => undefined);
				setDirty(false);
				setRestored(false);
				setRestoredAt(null);
				setFieldErrors([]);
				setSuccess(true);
				return;
			}
			// The action echoes nothing to re-apply: the draft is the reader's, and
			// it is exactly what stays on screen.
			setFieldErrors(response.fieldErrors ?? []);
			setServerError(response.error ?? t("saveError"));
		});
	};

	const applyPondValue = (conflict: PondDeviceConflict) => {
		if (!conflict.canUsePondValue || conflict.pondValueToApplyG === null) return;
		const value = conflict.pondValueToApplyG;
		startTransition(async () => {
			const result = await updateDeviceDailyCap(conflict.deviceId, value);
			if (result.success) {
				setAppliedCeilingG(result.dailyCapG ?? value);
				toast.success(t("conflicts.usePondValueDone", { value: grams(value) }));
				router.refresh();
				return;
			}
			toast.error(result.error ?? t("saveError"));
		});
	};

	const discardDraft = () => {
		clearPondDraft(sessionStorageOrNull(), pond.id);
		void discardPondSettingsDraft(pond.id).catch(() => undefined);
		setDraft(initialDraft(pond));
		setDirty(false);
		setRestored(false);
		setRestoredAt(null);
		setFieldErrors([]);
		setServerError(null);
		setAppliedCeilingG(null);
		toast.success(t("draftDiscarded"));
	};

	const hasProblems = fieldErrors.length > 0 || visibleConflicts.length > 0 || serverError !== null;

	return (
		<form
			onSubmit={handleSubmit}
			noValidate
			className="flex flex-col gap-6"
			data-help="pond-settings-form"
		>
			{restored && (
				<output className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
					<span className="flex items-center gap-2">
						<RotateCcw aria-hidden="true" className="h-4 w-4 shrink-0" />
						{restoredAt
							? t("restoredDraftAt", {
									time: formatFarmDateTime(new Date(restoredAt), (key) => tDates(key)).full,
								})
							: t("restoredDraft")}
					</span>
					<button
						type="button"
						onClick={discardDraft}
						className="rounded-lg border border-blue-300 px-3 py-1.5 font-black text-blue-900 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-900/50 dark:focus-visible:ring-[#8fc0ea]"
					>
						{t("discardDraft")}
					</button>
				</output>
			)}

			{/* Live derived values: what the typed settings ask the feeder to do. */}
			<section
				aria-labelledby="pond-derived-title"
				className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60"
			>
				<p
					id="pond-derived-title"
					className="flex items-center gap-2 text-xs font-black tracking-wide text-[#3D5568] uppercase dark:text-gray-300"
				>
					<SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0" />
					{t("derivedTitle")}
				</p>
				<dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{t("derivedDaily")}
						</dt>
						<dd className="mt-0.5 text-sm font-black text-[#0A3D62] dark:text-gray-100">
							{preview.dailyG !== null ? grams(preview.dailyG) : "—"}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{t("derivedPerMeal")}
						</dt>
						<dd className="mt-0.5 text-sm font-black text-[#0A3D62] dark:text-gray-100">
							{preview.perMealG !== null ? grams(preview.perMealG) : "—"}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{t("derivedDeviceCeiling")}
						</dt>
						<dd className="mt-0.5 text-sm font-bold text-[#3D5568] dark:text-gray-300">
							{device ? `${grams(device.effectiveDailyCapG)}/day` : "—"}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
							{t("derivedDeviceMaxDose")}
						</dt>
						<dd className="mt-0.5 text-sm font-bold text-[#3D5568] dark:text-gray-300">
							{deviceMaxDoseG !== null ? grams(deviceMaxDoseG) : "—"}
						</dd>
					</div>
				</dl>
				<p className="mt-3 text-[11px] font-medium text-[#3D5568] dark:text-gray-400">
					{preview.status === "ready" ? t("derivedHint") : t("derivedNoBiomass")}
				</p>
			</section>

			{/* The summary is the map: every problem links to its exact control. */}
			{hasProblems && (
				<section
					aria-labelledby={summaryId}
					role="alert"
					className="rounded-xl border border-[#C42B3A]/30 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30"
				>
					<h2
						id={summaryId}
						className="flex items-center gap-2 text-sm font-black text-[#C42B3A] dark:text-red-300"
					>
						<AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
						{t("errorSummaryTitle")}
					</h2>
					<p className="mt-1 text-xs font-medium text-[#7F1D1D] dark:text-red-200">
						{t("errorSummaryHint")}
					</p>
					<ul className="mt-3 space-y-1.5 text-sm font-bold">
						{fieldErrors.map((error) => {
							const spec = pondFieldSpec(error.field);
							return (
								<li key={`${error.field}:${error.code}`}>
									<button
										type="button"
										onClick={() => focusField(error.field)}
										className="inline-flex items-start gap-1.5 text-left text-[#C42B3A] underline decoration-[#C42B3A]/40 underline-offset-2 hover:decoration-[#C42B3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-red-300 dark:focus-visible:ring-[#8fc0ea]"
									>
										<ArrowRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
										<span>
											{t(spec.labelKey)}: {t(POND_SETTINGS_ERROR_KEYS[error.code])}
										</span>
									</button>
								</li>
							);
						})}
						{visibleConflicts.map((conflict) => (
							<li key={`${conflict.code}:${conflict.deviceId}`}>
								<Link
									href={conflict.href}
									onClick={() => requestHelpTarget(conflict.target, conflict.route)}
									className="inline-flex items-start gap-1.5 text-left text-[#C42B3A] underline decoration-[#C42B3A]/40 underline-offset-2 hover:decoration-[#C42B3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-red-300 dark:focus-visible:ring-[#8fc0ea]"
								>
									<ArrowRight aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<span>{conflictTitle(conflict)}</span>
								</Link>
							</li>
						))}
						{serverError && fieldErrors.length === 0 && visibleConflicts.length === 0 && (
							<li className="text-[#C42B3A] dark:text-red-300">{serverError}</li>
						)}
					</ul>
				</section>
			)}

			<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
				{POND_SETTINGS_FIELDS.map((spec) => {
					const errors = fieldErrors.filter((error) => error.field === spec.field);
					const fieldConflicts = visibleConflicts.filter(
						(conflict) => conflict.field === spec.field,
					);
					const messages = [
						...errors.map((error) => t(POND_SETTINGS_ERROR_KEYS[error.code])),
						...fieldConflicts.map((conflict) => conflictMessage(conflict)),
					];
					const hasError = messages.length > 0;
					const hintId = `${spec.inputId}-hint`;
					const errorId = `${spec.inputId}-error`;
					const placeholderKey = PLACEHOLDER_KEYS[spec.field];
					return (
						<div key={spec.field} data-help={spec.target}>
							<label htmlFor={spec.inputId} className={dashboardLabel}>
								{t(spec.labelKey)}
							</label>
							<input
								{...INPUT_PROPS[spec.field]}
								id={spec.inputId}
								value={draft[FIELD_KEYS[spec.field]]}
								onChange={(event) => update(FIELD_KEYS[spec.field], event.target.value)}
								placeholder={placeholderKey ? t(placeholderKey) : undefined}
								disabled={!canWrite}
								aria-invalid={hasError || undefined}
								aria-describedby={hasError ? `${errorId} ${hintId}` : hintId}
								className={cn(dashboardField, hasError && "border-[#C42B3A] dark:border-red-500")}
							/>
							<span id={hintId} className={dashboardHint}>
								{t(HINT_KEYS[spec.field])}
							</span>
							{hasError && (
								<p id={errorId} className="mt-1 space-y-0.5">
									{messages.map((message) => (
										<span
											key={message}
											className="block text-xs font-bold text-[#C42B3A] dark:text-red-300"
										>
											{message}
										</span>
									))}
								</p>
							)}
						</div>
					);
				})}

				<div>
					<p className={dashboardLabel}>{t("densityLabel")}</p>
					<p className="flex min-h-11 items-center rounded-xl bg-[#F4F7F6] px-4 py-2 text-sm font-black text-[#0A3D62] dark:bg-gray-800 dark:text-gray-100">
						{density !== null ? t("densityValue", { density }) : t("densityNoArea")}
					</p>
				</div>
			</div>

			{/* The conflict cards: pond value first, device value second. */}
			{visibleConflicts.length > 0 && (
				<ul className="space-y-3">
					{visibleConflicts.map((conflict) => (
						<li
							key={`${conflict.code}:${conflict.deviceId}`}
							className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
						>
							<p className="flex items-center gap-2 text-sm font-black text-amber-900 dark:text-amber-200">
								<AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
								{conflictTitle(conflict)}
							</p>
							<p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-200">
								{t("conflicts.pondWins")}
							</p>
							<p className="mt-2 text-xs font-bold text-amber-900 dark:text-amber-100">
								{conflictMessage(conflict)}
							</p>
							{conflict.code === "relay-time" &&
								savedPlanAlreadyOver &&
								deviceMaxDoseG !== null && (
									<p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-200">
										{t("conflicts.preExisting", {
											saved: grams(savedPerMealG ?? 0),
											max: grams(deviceMaxDoseG),
										})}
									</p>
								)}
							{conflict.code === "relay-time" && conflict.suggestedFeedsPerDay !== null && (
								<p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-200">
									{t("conflicts.suggestedFeeds", { count: conflict.suggestedFeedsPerDay })}
								</p>
							)}
							{conflictReason(conflict) && (
								<p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-200">
									{conflictReason(conflict)}
								</p>
							)}
							<div className="mt-3 flex flex-wrap items-center gap-2">
								{conflict.canUsePondValue && (
									<button
										type="button"
										disabled={isPending || !canWrite}
										onClick={() => applyPondValue(conflict)}
										className={cn(dashboardButtonPrimary, "min-h-10 px-3 text-xs")}
									>
										{t("conflicts.usePondValue", {
											value: grams(conflict.pondValueToApplyG ?? conflict.pondValueG),
										})}
									</button>
								)}
								<Link
									href={conflict.href}
									onClick={() => requestHelpTarget(conflict.target, conflict.route)}
									className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-amber-400 px-3 text-xs font-black text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40 dark:focus-visible:ring-[#8fc0ea]"
								>
									{t("conflicts.openSetting")}
									<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
								</Link>
							</div>
						</li>
					))}
				</ul>
			)}

			<div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", mobileStickyActions)}>
				<button
					type="submit"
					disabled={isPending || !canWrite}
					className={cn(dashboardButtonPrimary, "sm:min-w-[140px]")}
				>
					{isPending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
					{isPending ? t("saving") : t("saveSettings")}
				</button>
				{success && (
					<output className="flex items-center gap-1 text-sm font-bold text-[#1E7B34] dark:text-green-300">
						<CheckCircle2 size={18} aria-hidden="true" />
						{t("success")}
					</output>
				)}
			</div>
		</form>
	);
}
