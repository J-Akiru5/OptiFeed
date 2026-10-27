"use client";

import {
	getCalibrationTestStatus,
	runCalibrationTest,
	saveCalibrationFromTest,
} from "@/lib/actions/calibration";
import { saveDurationCalibration } from "@/lib/actions/energy";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const MIN_TEST_SECONDS = 3;
const MAX_TEST_SECONDS = 30;
const TEST_PRESETS = [5, 10, 15, 20];
const MAX_TEST_DOSE_G = 1000;
const MIN_RATE = 0.5;
const MAX_RATE = 50;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

type CalibrationMode = "guided" | "manual";
type TestPhase = "idle" | "queueing" | "polling" | "completed" | "expired" | "timeout" | "error";
type TestStatus = "pending" | "dispatched" | "completed" | "expired" | "missing";

interface GuidedTest {
	requestId: string;
	seconds: number;
}

interface CalibrationResult {
	source: CalibrationMode;
	previousGramsPerSecond: number;
	newGramsPerSecond: number;
	previousDurationSeconds: number;
	newDurationSeconds: number;
}

interface DurationCalibrationFormProps {
	deviceId: string;
	currentGramsPerSecond: number;
	currentGramsPerFeeding: number;
	canWrite?: boolean;
	isOffline?: boolean;
	isFallow?: boolean;
}

function formatRate(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) return "—";
	return String(Number(rate.toFixed(2)));
}

function formatGrams(grams: number): string {
	if (!Number.isFinite(grams) || grams <= 0) return "0";
	return String(Number(grams.toFixed(1)));
}

function formatSeconds(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "—";
	if (seconds >= 100) return String(Math.round(seconds));
	return String(Number(seconds.toFixed(1)));
}

function durationFor(gramsPerFeeding: number, gramsPerSecond: number): number {
	if (!Number.isFinite(gramsPerFeeding) || gramsPerFeeding <= 0) return 0;
	if (!Number.isFinite(gramsPerSecond) || gramsPerSecond <= 0) return 0;
	return gramsPerFeeding / gramsPerSecond;
}

export function DurationCalibrationForm({
	deviceId,
	currentGramsPerSecond,
	currentGramsPerFeeding,
	canWrite = true,
	isOffline = false,
	isFallow = false,
}: DurationCalibrationFormProps) {
	const t = useTranslations("dashboard.appSettings.calibration");
	const router = useRouter();

	const [mode, setMode] = useState<CalibrationMode>("guided");
	const [testSecondsInput, setTestSecondsInput] = useState("10");
	const [phase, setPhase] = useState<TestPhase>("idle");
	const [activeTest, setActiveTest] = useState<GuidedTest | null>(null);
	const [status, setStatus] = useState<TestStatus | null>(null);
	const [actualGramsInput, setActualGramsInput] = useState("");
	const [testError, setTestError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [lastResult, setLastResult] = useState<CalibrationResult | null>(null);
	const [isGuidedSaving, startGuidedSave] = useTransition();

	const [manualRateInput, setManualRateInput] = useState(String(currentGramsPerSecond));
	const [manualError, setManualError] = useState<string | null>(null);
	const [isManualSaving, startManualSave] = useTransition();

	const currentDurationSeconds = durationFor(currentGramsPerFeeding, currentGramsPerSecond);

	const testSeconds = Number(testSecondsInput);
	const isTestDurationValid =
		testSecondsInput.trim() !== "" &&
		Number.isFinite(testSeconds) &&
		testSeconds >= MIN_TEST_SECONDS &&
		testSeconds <= MAX_TEST_SECONDS;
	const expectedTestDoseG = isTestDurationValid ? currentGramsPerSecond * testSeconds : 0;
	const testLocked = phase === "queueing" || phase === "polling" || phase === "completed";
	const activeTestSeconds = activeTest?.seconds ?? (isTestDurationValid ? testSeconds : 0);

	const actualGrams = Number(actualGramsInput);
	const isActualGramsValid =
		actualGramsInput.trim() !== "" && Number.isFinite(actualGrams) && actualGrams > 0;
	const newGramsPerSecond =
		isActualGramsValid && activeTestSeconds > 0 ? actualGrams / activeTestSeconds : 0;
	const isNewRateInRange = newGramsPerSecond >= MIN_RATE && newGramsPerSecond <= MAX_RATE;
	const newDurationSeconds = durationFor(currentGramsPerFeeding, newGramsPerSecond);

	const manualRate = Number(manualRateInput);
	const isManualRateValid =
		manualRateInput.trim() !== "" &&
		Number.isFinite(manualRate) &&
		manualRate >= MIN_RATE &&
		manualRate <= MAX_RATE;
	const manualDurationSeconds = durationFor(currentGramsPerFeeding, manualRate);

	let blockReason: string | null = null;
	if (!isTestDurationValid) {
		blockReason = t("guided.blockedInvalidDuration");
	} else if (isOffline) {
		blockReason = t("guided.blockedOffline");
	} else if (isFallow) {
		blockReason = t("guided.blockedFallow");
	} else if (!canWrite) {
		blockReason = t("guided.blockedReadOnly");
	} else if (!Number.isFinite(currentGramsPerSecond) || currentGramsPerSecond <= 0) {
		blockReason = t("guided.blockedInvalidRate");
	} else if (expectedTestDoseG > MAX_TEST_DOSE_G) {
		blockReason = t("guided.blockedTooLarge", {
			grams: formatGrams(expectedTestDoseG),
		});
	}

	const canRunTest = blockReason === null && !testLocked;
	const isPolling = phase === "queueing" || phase === "polling";

	let statusMessage: string | null = null;
	if (phase === "queueing") {
		statusMessage = t("guided.queueing");
	} else if (phase === "polling") {
		statusMessage =
			status === "dispatched" ? t("guided.statusDispatched") : t("guided.statusPending");
	} else if (phase === "completed") {
		statusMessage = t("guided.statusCompleted");
	} else if (phase === "expired") {
		statusMessage = status === "missing" ? t("guided.statusMissing") : t("guided.statusExpired");
	} else if (phase === "timeout") {
		statusMessage = t("guided.statusTimeout");
	} else if (phase === "error") {
		statusMessage = t("guided.statusFailed");
	}

	const activeRequestId = activeTest?.requestId ?? null;

	useEffect(() => {
		if (phase !== "polling" || !activeRequestId) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const startedAt = Date.now();

		const poll = async () => {
			try {
				const result = await getCalibrationTestStatus(deviceId, activeRequestId);
				if (cancelled) return;

				if (!result.success) {
					setPhase("error");
					return;
				}

				setStatus(result.status ?? null);

				if (result.status === "completed") {
					setPhase("completed");
					return;
				}

				if (result.status === "expired" || result.status === "missing") {
					setPhase("expired");
					return;
				}

				if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
					setPhase("timeout");
					return;
				}

				timer = setTimeout(poll, POLL_INTERVAL_MS);
			} catch {
				if (!cancelled) setPhase("error");
			}
		};

		void poll();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [phase, activeRequestId, deviceId]);

	const resetTest = () => {
		setActiveTest(null);
		setStatus(null);
		setActualGramsInput("");
		setTestError(null);
		setSaveError(null);
		setPhase("idle");
	};

	const handleRunTest = async () => {
		if (!canRunTest) return;

		const seconds = Number(testSecondsInput);
		setTestError(null);
		setSaveError(null);
		setActualGramsInput("");
		setStatus(null);
		setPhase("queueing");

		try {
			const result = await runCalibrationTest(deviceId, seconds);
			if (result.success && result.requestId) {
				setActiveTest({ requestId: result.requestId, seconds });
				setStatus("pending");
				setPhase("polling");
				return;
			}

			setActiveTest(null);
			setTestError(result.error ?? t("guided.testStartError"));
			setPhase("error");
		} catch {
			setActiveTest(null);
			setTestError(t("genericError"));
			setPhase("error");
		}
	};

	const handleSaveGuided = () => {
		if (!activeTest || !isActualGramsValid || !isNewRateInRange || !canWrite) return;

		const { requestId, seconds } = activeTest;
		setSaveError(null);

		startGuidedSave(async () => {
			try {
				const result = await saveCalibrationFromTest(deviceId, requestId, seconds, actualGrams);

				if (!result.success) {
					setSaveError(result.error ?? t("guided.saveError"));
					return;
				}

				const previousRate = result.previousGramsPerSecond ?? currentGramsPerSecond;
				const nextRate = result.newGramsPerSecond ?? actualGrams / seconds;
				const gramsPerFeeding = result.gramsPerFeeding ?? currentGramsPerFeeding;

				setLastResult({
					source: "guided",
					previousGramsPerSecond: previousRate,
					newGramsPerSecond: nextRate,
					previousDurationSeconds:
						result.previousDurationSeconds ?? durationFor(gramsPerFeeding, previousRate),
					newDurationSeconds: result.newDurationSeconds ?? durationFor(gramsPerFeeding, nextRate),
				});
				setActiveTest(null);
				setStatus(null);
				setActualGramsInput("");
				setTestError(null);
				setPhase("idle");
				toast.success(t("savedToast"));
				router.refresh();
			} catch {
				setSaveError(t("genericError"));
			}
		});
	};

	const handleSaveManual = () => {
		if (!isManualRateValid || !canWrite) return;

		const nextRate = Number(manualRateInput);
		setManualError(null);

		startManualSave(async () => {
			try {
				const result = await saveDurationCalibration(deviceId, nextRate);
				if (!result.success) {
					setManualError(result.error ?? t("manual.error"));
					return;
				}

				setLastResult({
					source: "manual",
					previousGramsPerSecond: currentGramsPerSecond,
					newGramsPerSecond: nextRate,
					previousDurationSeconds: durationFor(currentGramsPerFeeding, currentGramsPerSecond),
					newDurationSeconds: durationFor(currentGramsPerFeeding, nextRate),
				});
				toast.success(t("savedToast"));
				router.refresh();
			} catch {
				setManualError(t("genericError"));
			}
		});
	};

	const statusTone =
		phase === "completed"
			? "border-[#1E7B34]/30 bg-[#1E7B34]/5 dark:border-green-900/50 dark:bg-green-900/20"
			: phase === "expired" || phase === "timeout" || phase === "error"
				? "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
				: "border-[#0A3D62]/15 bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-800/60";

	return (
		<div className="space-y-5">
			<dl className="grid gap-3 sm:grid-cols-3">
				<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
					<dt className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("currentRate")}
					</dt>
					<dd className="mt-1 text-lg font-bold text-[#0A3D62] dark:text-gray-100">
						{t("rateValue", { rate: formatRate(currentGramsPerSecond) })}
					</dd>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
					<dt className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("currentGramsPerFeeding")}
					</dt>
					<dd className="mt-1 text-lg font-bold text-[#0A3D62] dark:text-gray-100">
						{t("gramsValue", { grams: formatGrams(currentGramsPerFeeding) })}
					</dd>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
					<dt className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("currentDuration")}
					</dt>
					<dd className="mt-1 text-lg font-bold text-[#0A3D62] dark:text-gray-100">
						{t("durationValue", { seconds: formatSeconds(currentDurationSeconds) })}
					</dd>
				</div>
			</dl>

			<div
				role="tablist"
				aria-label={t("modesLabel")}
				className="inline-flex w-full flex-col gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 sm:w-auto sm:flex-row"
			>
				<button
					type="button"
					role="tab"
					id="calibration-tab-guided"
					aria-selected={mode === "guided"}
					aria-controls="calibration-panel-guided"
					onClick={() => setMode("guided")}
					className={cn(
						"flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors",
						mode === "guided"
							? "bg-white text-[#0A3D62] shadow-sm dark:bg-gray-700 dark:text-gray-100"
							: "text-gray-600 hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-200",
					)}
				>
					{t("tabGuided")}
				</button>
				<button
					type="button"
					role="tab"
					id="calibration-tab-manual"
					aria-selected={mode === "manual"}
					aria-controls="calibration-panel-manual"
					onClick={() => setMode("manual")}
					className={cn(
						"flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors",
						mode === "manual"
							? "bg-white text-[#0A3D62] shadow-sm dark:bg-gray-700 dark:text-gray-100"
							: "text-gray-600 hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-200",
					)}
				>
					{t("tabManual")}
				</button>
			</div>

			<div
				role="tabpanel"
				id="calibration-panel-guided"
				aria-labelledby="calibration-tab-guided"
				hidden={mode !== "guided"}
				className="space-y-4"
			>
				<p className="text-sm text-gray-600 dark:text-gray-300">{t("guided.intro")}</p>

				<div className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<label
							htmlFor="calibration-test-seconds"
							className="text-sm font-medium text-gray-700 dark:text-gray-200"
						>
							{t("guided.durationLabel")}
						</label>
						<span className="text-xs text-gray-500 dark:text-gray-400">
							{t("guided.durationHelp")}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<input
							id="calibration-test-seconds"
							type="number"
							min={MIN_TEST_SECONDS}
							max={MAX_TEST_SECONDS}
							step={1}
							inputMode="numeric"
							value={testSecondsInput}
							onChange={(event) => setTestSecondsInput(event.target.value)}
							disabled={testLocked}
							className="min-h-[var(--ofd-touch-min)] w-28 rounded-lg border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
						/>
						<fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
							<legend className="sr-only">{t("guided.presetsLabel")}</legend>
							{TEST_PRESETS.map((preset) => (
								<button
									key={preset}
									type="button"
									onClick={() => setTestSecondsInput(String(preset))}
									disabled={testLocked}
									aria-pressed={testSeconds === preset}
									className={cn(
										"min-h-11 rounded-lg border px-4 text-sm font-semibold transition-colors disabled:opacity-60",
										testSeconds === preset
											? "border-[var(--ofd-base)] bg-[var(--ofd-base)] text-white"
											: "border-gray-200 bg-white text-gray-700 hover:border-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200",
									)}
								>
									{t("guided.presetValue", { seconds: preset })}
								</button>
							))}
						</fieldset>
					</div>
				</div>

				<div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
							{t("guided.expectedDose")}
						</p>
						<p className="text-lg font-bold text-blue-900 dark:text-blue-100">
							{t("gramsValue", { grams: formatGrams(expectedTestDoseG) })}
						</p>
					</div>
					<p className="mt-1 text-xs text-blue-700 dark:text-blue-300">{t("guided.feedWarning")}</p>
				</div>

				{phase !== "completed" && (
					<div className="space-y-2">
						<button
							type="button"
							onClick={handleRunTest}
							disabled={!canRunTest}
							className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
						>
							{isPolling ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							) : (
								<FlaskConical className="h-4 w-4" aria-hidden="true" />
							)}
							{phase === "queueing" ? t("guided.queueing") : t("guided.runButton")}
						</button>
						{blockReason && (
							<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
								{blockReason}
							</p>
						)}
					</div>
				)}

				{(statusMessage || testError) && (
					<div
						aria-live="polite"
						aria-atomic="true"
						className={cn("flex items-start gap-3 rounded-xl border p-4", statusTone)}
					>
						{isPolling ? (
							<Loader2
								className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#0A3D62] dark:text-gray-300"
								aria-hidden="true"
							/>
						) : phase === "completed" ? (
							<CheckCircle2
								className="mt-0.5 h-5 w-5 shrink-0 text-[#1E7B34] dark:text-green-400"
								aria-hidden="true"
							/>
						) : (
							<AlertTriangle
								className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
								aria-hidden="true"
							/>
						)}
						<div className="space-y-1">
							<p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
								{t("guided.statusLabel")}
							</p>
							<p className="text-sm font-medium text-gray-800 dark:text-gray-100">
								{testError ?? statusMessage}
							</p>
							{phase === "polling" && (
								<p className="text-xs text-gray-600 dark:text-gray-400">
									{t("guided.pollingNote")}
								</p>
							)}
							{(phase === "expired" || phase === "timeout" || phase === "error") && (
								<>
									{(phase === "expired" || phase === "timeout") && (
										<p className="text-xs text-gray-600 dark:text-gray-400">
											{t("guided.expiredHelp")}
										</p>
									)}
									<button
										type="button"
										onClick={resetTest}
										className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-[#0A3D62]/20 bg-white px-4 text-sm font-semibold text-[#0A3D62] transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
									>
										{t("guided.runAnother")}
									</button>
								</>
							)}
						</div>
					</div>
				)}

				{phase === "completed" && activeTest && (
					<div className="space-y-4 rounded-xl border border-[#0A3D62]/10 bg-[#F4F7F6] p-4 dark:border-gray-700 dark:bg-gray-800/60">
						<div>
							<h3 className="flex items-center gap-2 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								<Scale className="h-4 w-4" aria-hidden="true" />
								{t("guided.weighTitle")}
							</h3>
							<p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
								{t("guided.weighDesc")}
							</p>
						</div>

						<div className="space-y-1">
							<label
								htmlFor="calibration-actual-grams"
								className="text-sm font-medium text-gray-700 dark:text-gray-200"
							>
								{t("guided.actualGramsLabel")}
							</label>
							<input
								id="calibration-actual-grams"
								type="number"
								min={0}
								step={0.1}
								inputMode="decimal"
								placeholder={t("guided.actualGramsPlaceholder")}
								value={actualGramsInput}
								onChange={(event) => setActualGramsInput(event.target.value)}
								className="min-h-[var(--ofd-touch-min)] w-full rounded-lg border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 sm:w-48"
							/>
							{actualGramsInput.trim() !== "" && !isActualGramsValid && (
								<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
									{t("guided.invalidWeight")}
								</p>
							)}
							{isActualGramsValid && !isNewRateInRange && (
								<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
									{t("guided.rateOutOfRange", {
										rate: formatRate(newGramsPerSecond),
									})}
								</p>
							)}
						</div>

						<div>
							<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
								{t("guided.previewTitle")}
							</p>
							<div className="mt-2 grid gap-3 sm:grid-cols-2">
								<div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
									<p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
										{t("guided.before")}
									</p>
									<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
										{t("rateValue", {
											rate: formatRate(currentGramsPerSecond),
										})}
									</p>
									<p className="text-xs text-gray-600 dark:text-gray-400">
										{t("durationValue", {
											seconds: formatSeconds(currentDurationSeconds),
										})}
									</p>
								</div>
								<div className="rounded-lg border border-[#1E7B34]/30 bg-white p-3 dark:border-green-900/50 dark:bg-gray-900">
									<p className="text-[11px] font-bold uppercase tracking-wide text-[#1E7B34] dark:text-green-300">
										{t("guided.after")}
									</p>
									<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
										{t("rateValue", { rate: formatRate(newGramsPerSecond) })}
									</p>
									<p className="text-xs text-gray-600 dark:text-gray-400">
										{t("durationValue", {
											seconds: formatSeconds(newDurationSeconds),
										})}
									</p>
								</div>
							</div>
						</div>

						{saveError && (
							<p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
								{saveError}
							</p>
						)}

						<button
							type="button"
							onClick={handleSaveGuided}
							disabled={!canWrite || !isActualGramsValid || !isNewRateInRange || isGuidedSaving}
							className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
						>
							{isGuidedSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
							{isGuidedSaving ? t("guided.saving") : t("guided.saveButton")}
						</button>
					</div>
				)}
			</div>

			<div
				role="tabpanel"
				id="calibration-panel-manual"
				aria-labelledby="calibration-tab-manual"
				hidden={mode !== "manual"}
				className="space-y-4"
			>
				<p className="text-sm text-gray-600 dark:text-gray-300">{t("manual.intro")}</p>

				<div className="space-y-1">
					<label
						htmlFor="calibration-manual-rate"
						className="text-sm font-medium text-gray-700 dark:text-gray-200"
					>
						{t("manual.rateLabel")}
					</label>
					<input
						id="calibration-manual-rate"
						type="number"
						min={MIN_RATE}
						max={MAX_RATE}
						step={0.1}
						inputMode="decimal"
						value={manualRateInput}
						onChange={(event) => setManualRateInput(event.target.value)}
						className="min-h-[var(--ofd-touch-min)] w-full rounded-lg border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:w-48"
					/>
					<p className="text-xs text-gray-500 dark:text-gray-400">{t("manual.rateHelp")}</p>
					{manualRateInput.trim() !== "" && !isManualRateValid && (
						<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
							{t("manual.invalidRate")}
						</p>
					)}
				</div>

				<div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20">
					<p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
						{t("guided.previewTitle")}
					</p>
					{isManualRateValid ? (
						<p className="mt-1 text-sm font-medium text-blue-900 dark:text-blue-100">
							{t("manual.preview", {
								rate: formatRate(manualRate),
								grams: formatGrams(currentGramsPerFeeding),
								seconds: formatSeconds(manualDurationSeconds),
							})}
						</p>
					) : (
						<p className="mt-1 text-sm text-blue-700 dark:text-blue-300">—</p>
					)}
				</div>

				{manualError && (
					<p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
						{manualError}
					</p>
				)}

				{!canWrite && (
					<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
						{t("guided.blockedReadOnly")}
					</p>
				)}

				<button
					type="button"
					onClick={handleSaveManual}
					disabled={!canWrite || !isManualRateValid || isManualSaving}
					className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
				>
					{isManualSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
					{isManualSaving ? t("manual.saving") : t("manual.saveButton")}
				</button>
			</div>

			{lastResult && (
				<section
					aria-live="polite"
					className="rounded-xl border border-[#1E7B34]/25 bg-[#1E7B34]/5 p-4 dark:border-green-900/50 dark:bg-green-900/20"
				>
					<p className="text-xs font-bold uppercase tracking-wide text-[#1E7B34] dark:text-green-300">
						{t("lastResult.title")}
					</p>
					<div className="mt-2 grid gap-3 sm:grid-cols-2">
						<div>
							<p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
								{t("lastResult.before")}
							</p>
							<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{t("rateValue", {
									rate: formatRate(lastResult.previousGramsPerSecond),
								})}
							</p>
							<p className="text-xs text-gray-600 dark:text-gray-400">
								{t("durationValue", {
									seconds: formatSeconds(lastResult.previousDurationSeconds),
								})}
							</p>
						</div>
						<div>
							<p className="text-[11px] font-bold uppercase tracking-wide text-[#1E7B34] dark:text-green-300">
								{t("lastResult.after")}
							</p>
							<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{t("rateValue", { rate: formatRate(lastResult.newGramsPerSecond) })}
							</p>
							<p className="text-xs text-gray-600 dark:text-gray-400">
								{t("durationValue", {
									seconds: formatSeconds(lastResult.newDurationSeconds),
								})}
							</p>
						</div>
					</div>
					<p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
						{lastResult.source === "guided"
							? t("lastResult.guidedSource")
							: t("lastResult.manualSource")}
					</p>
				</section>
			)}
		</div>
	);
}
