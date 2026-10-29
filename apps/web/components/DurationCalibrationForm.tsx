"use client";

import {
	CalibrationNumberField,
	calibrationFieldGrid,
	parseCalibrationNumber,
} from "@/components/calibration/CalibrationNumberField";
import {
	type TargetCheckDecision,
	type TargetCheckSubmitResult,
	getCalibrationTestStatus,
	runCalibrationTest,
	runTargetCheck,
	saveCalibrationFromTest,
	submitTargetCheck,
} from "@/lib/actions/calibration";
import { saveDurationCalibration } from "@/lib/actions/energy";
import { CALIBRATION_ACTUAL_GRAMS_MAX } from "@/lib/limits";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Scale, Target } from "lucide-react";
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
const MIN_TARGET_G = 5;
const MAX_TARGET_G = 500;
const TARGET_TOLERANCE_PCT = 5;
const MAX_DISPENSE_SECONDS = 300;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;

// Field rules shared by the number inputs below. Rates and offsets the server
// stores with two decimals accept two here as well, so a stored 4.25 g/s does
// not open the form in an invalid state; the stepper still moves by 0.1.
const TEST_SECONDS_RULES = {
	min: MIN_TEST_SECONDS,
	max: MAX_TEST_SECONDS,
	decimals: 0,
	step: 1,
} as const;
const ACTUAL_GRAMS_RULES = {
	min: 0,
	max: CALIBRATION_ACTUAL_GRAMS_MAX,
	decimals: 1,
	step: 0.1,
} as const;
const TARGET_GRAMS_RULES = {
	min: MIN_TARGET_G,
	max: MAX_TARGET_G,
	decimals: 1,
	step: 0.1,
} as const;
const MANUAL_RATE_RULES = {
	min: MIN_RATE,
	max: MAX_RATE,
	decimals: 2,
	step: 0.1,
} as const;

type CalibrationMode = "guided" | "target" | "manual";
type TestPhase = "idle" | "queueing" | "polling" | "completed" | "expired" | "timeout" | "error";
type TestStatus = "pending" | "dispatched" | "completed" | "expired" | "missing";

interface GuidedTest {
	requestId: string;
	seconds: number;
}

interface TargetCheckTest {
	requestId: string;
	targetGrams: number;
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

	// One sitting = one session id. Generated on the client so attempts from
	// this visit share a session even across route refreshes; the server
	// validates the shape and computes the attempt number itself.
	const [sessionId] = useState(() => {
		try {
			return crypto.randomUUID();
		} catch {
			// cuid-shaped fallback for a context without crypto.randomUUID.
			const token = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
			return token.padEnd(25, "0").slice(0, 25);
		}
	});

	const defaultTargetGrams = Math.min(
		MAX_TARGET_G,
		Math.max(MIN_TARGET_G, Math.round(currentGramsPerFeeding)),
	);
	const [targetInput, setTargetInput] = useState(String(defaultTargetGrams));
	const [targetPhase, setTargetPhase] = useState<TestPhase>("idle");
	const [activeTargetCheck, setActiveTargetCheck] = useState<TargetCheckTest | null>(null);
	const [targetStatus, setTargetStatus] = useState<TestStatus | null>(null);
	const [targetMeasuredInput, setTargetMeasuredInput] = useState("");
	const [targetError, setTargetError] = useState<string | null>(null);
	const [targetSubmitError, setTargetSubmitError] = useState<string | null>(null);
	const [nextAttemptNumber, setNextAttemptNumber] = useState(1);
	const [targetResult, setTargetResult] = useState<TargetCheckSubmitResult | null>(null);
	const [isTargetSubmitting, startTargetSubmit] = useTransition();

	const currentDurationSeconds = durationFor(currentGramsPerFeeding, currentGramsPerSecond);

	const testSecondsResult = parseCalibrationNumber(testSecondsInput, TEST_SECONDS_RULES);
	const testSeconds = testSecondsResult.status === "valid" ? testSecondsResult.value : 0;
	const isTestDurationValid = testSecondsResult.status === "valid";
	const expectedTestDoseG = isTestDurationValid ? currentGramsPerSecond * testSeconds : 0;
	const testLocked = phase === "queueing" || phase === "polling" || phase === "completed";
	const activeTestSeconds = activeTest?.seconds ?? (isTestDurationValid ? testSeconds : 0);

	const actualGramsResult = parseCalibrationNumber(actualGramsInput, ACTUAL_GRAMS_RULES);
	const actualGrams = actualGramsResult.status === "valid" ? actualGramsResult.value : 0;
	const isActualGramsValid = actualGramsResult.status === "valid" && actualGrams > 0;
	const actualGramsError =
		actualGramsResult.status === "valid" && actualGrams <= 0
			? t("guided.invalidWeight")
			: undefined;
	const newGramsPerSecond =
		isActualGramsValid && activeTestSeconds > 0 ? actualGrams / activeTestSeconds : 0;
	const isNewRateInRange = newGramsPerSecond >= MIN_RATE && newGramsPerSecond <= MAX_RATE;
	const newDurationSeconds = durationFor(currentGramsPerFeeding, newGramsPerSecond);

	const manualRateResult = parseCalibrationNumber(manualRateInput, MANUAL_RATE_RULES);
	const manualRate = manualRateResult.status === "valid" ? manualRateResult.value : 0;
	const isManualRateValid = manualRateResult.status === "valid";
	const manualDurationSeconds = durationFor(currentGramsPerFeeding, manualRate);

	const targetParse = parseCalibrationNumber(targetInput, TARGET_GRAMS_RULES);
	const targetGrams = targetParse.status === "valid" ? targetParse.value : 0;
	const isTargetValid = targetParse.status === "valid";
	const activeTargetGrams = activeTargetCheck?.targetGrams ?? (isTargetValid ? targetGrams : 0);
	const targetExpectedSeconds = durationFor(activeTargetGrams, currentGramsPerSecond);

	const measuredResult = parseCalibrationNumber(targetMeasuredInput, ACTUAL_GRAMS_RULES);
	const targetMeasuredGrams = measuredResult.status === "valid" ? measuredResult.value : 0;
	const isTargetMeasuredValid = measuredResult.status === "valid" && targetMeasuredGrams > 0;
	const measuredGramsError =
		measuredResult.status === "valid" && targetMeasuredGrams <= 0
			? t("guided.invalidWeight")
			: undefined;
	const targetErrorPct =
		isTargetMeasuredValid && activeTargetGrams > 0
			? Math.round(((targetMeasuredGrams - activeTargetGrams) / activeTargetGrams) * 100 * 100) /
				100
			: 0;
	const targetCorrectedRate =
		isTargetMeasuredValid && activeTargetGrams > 0 && currentGramsPerSecond > 0
			? (currentGramsPerSecond * targetMeasuredGrams) / activeTargetGrams
			: 0;
	const targetIsAccepted =
		isTargetMeasuredValid && Math.abs(targetErrorPct) <= TARGET_TOLERANCE_PCT;
	const targetCorrectedOutOfRange =
		isTargetMeasuredValid &&
		targetCorrectedRate > 0 &&
		(targetCorrectedRate < MIN_RATE || targetCorrectedRate > MAX_RATE);
	const targetLocked =
		targetPhase === "queueing" || targetPhase === "polling" || targetPhase === "completed";

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

	let targetBlockReason: string | null = null;
	if (!isTargetValid) {
		targetBlockReason = t("targetCheck.blockedInvalidTarget", {
			min: MIN_TARGET_G,
			max: MAX_TARGET_G,
		});
	} else if (isOffline) {
		targetBlockReason = t("guided.blockedOffline");
	} else if (isFallow) {
		targetBlockReason = t("guided.blockedFallow");
	} else if (!canWrite) {
		targetBlockReason = t("guided.blockedReadOnly");
	} else if (!Number.isFinite(currentGramsPerSecond) || currentGramsPerSecond <= 0) {
		targetBlockReason = t("guided.blockedInvalidRate");
	} else if (targetGrams / currentGramsPerSecond > MAX_DISPENSE_SECONDS) {
		targetBlockReason = t("targetCheck.blockedTooLong", {
			seconds: MAX_DISPENSE_SECONDS,
		});
	}

	const canRunTargetCheck = targetBlockReason === null && !targetLocked;
	const isTargetPolling = targetPhase === "queueing" || targetPhase === "polling";

	let targetStatusMessage: string | null = null;
	if (targetPhase === "queueing") {
		targetStatusMessage = t("targetCheck.queueing");
	} else if (targetPhase === "polling") {
		targetStatusMessage =
			targetStatus === "dispatched"
				? t("targetCheck.statusDispatched")
				: t("targetCheck.statusPending");
	} else if (targetPhase === "completed") {
		targetStatusMessage = t("targetCheck.statusCompleted");
	} else if (targetPhase === "expired") {
		targetStatusMessage =
			targetStatus === "missing" ? t("targetCheck.statusMissing") : t("targetCheck.statusExpired");
	} else if (targetPhase === "timeout") {
		targetStatusMessage = t("targetCheck.statusTimeout");
	} else if (targetPhase === "error") {
		targetStatusMessage = t("targetCheck.statusFailed");
	}

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

	const activeTargetRequestId = activeTargetCheck?.requestId ?? null;

	useEffect(() => {
		if (targetPhase !== "polling" || !activeTargetRequestId) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const startedAt = Date.now();

		const poll = async () => {
			try {
				const result = await getCalibrationTestStatus(deviceId, activeTargetRequestId);
				if (cancelled) return;

				if (!result.success) {
					setTargetPhase("error");
					return;
				}

				setTargetStatus(result.status ?? null);

				if (result.status === "completed") {
					setTargetPhase("completed");
					return;
				}

				if (result.status === "expired" || result.status === "missing") {
					setTargetPhase("expired");
					return;
				}

				if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
					setTargetPhase("timeout");
					return;
				}

				timer = setTimeout(poll, POLL_INTERVAL_MS);
			} catch {
				if (!cancelled) setTargetPhase("error");
			}
		};

		void poll();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [targetPhase, activeTargetRequestId, deviceId]);

	const resetTest = () => {
		setActiveTest(null);
		setStatus(null);
		setActualGramsInput("");
		setTestError(null);
		setSaveError(null);
		setPhase("idle");
	};

	const resetTargetCheck = () => {
		setActiveTargetCheck(null);
		setTargetStatus(null);
		setTargetMeasuredInput("");
		setTargetError(null);
		setTargetSubmitError(null);
		setTargetPhase("idle");
	};

	const handleRunTest = async () => {
		if (!canRunTest) return;

		const seconds = testSeconds;
		setTestError(null);
		setSaveError(null);
		setActualGramsInput("");
		setStatus(null);
		setPhase("queueing");

		try {
			const result = await runCalibrationTest(deviceId, seconds, sessionId);
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

	const handleRunTargetCheck = async () => {
		if (!canRunTargetCheck) return;

		const target = targetGrams;
		setTargetError(null);
		setTargetSubmitError(null);
		setTargetMeasuredInput("");
		setTargetStatus(null);
		setTargetPhase("queueing");

		try {
			const result = await runTargetCheck(deviceId, target, sessionId);
			if (result.success && result.requestId && result.targetGrams) {
				setActiveTargetCheck({ requestId: result.requestId, targetGrams: result.targetGrams });
				setTargetStatus("pending");
				setTargetPhase("polling");
				return;
			}

			setActiveTargetCheck(null);
			setTargetError(result.error ?? t("targetCheck.startError"));
			setTargetPhase("error");
		} catch {
			setActiveTargetCheck(null);
			setTargetError(t("genericError"));
			setTargetPhase("error");
		}
	};

	const handleSubmitTargetCheck = (decision: TargetCheckDecision) => {
		if (!activeTargetCheck || !isTargetMeasuredValid || !canWrite) return;
		if (targetCorrectedOutOfRange) return;

		const { requestId, targetGrams: checkedTarget } = activeTargetCheck;
		setTargetSubmitError(null);

		startTargetSubmit(async () => {
			try {
				const result = await submitTargetCheck(
					deviceId,
					requestId,
					checkedTarget,
					targetMeasuredGrams,
					sessionId,
					decision,
				);

				if (!result.success) {
					setTargetSubmitError(result.error ?? t("targetCheck.saveError"));
					return;
				}

				setTargetResult(result);
				setNextAttemptNumber((result.attempt ?? 0) + 1);
				resetTargetCheck();

				if (result.saved) {
					toast.success(t("savedToast"));
				} else {
					toast.success(t("targetCheck.correctionApplied"));
				}
				router.refresh();
			} catch {
				setTargetSubmitError(t("genericError"));
			}
		});
	};

	const handleSaveGuided = () => {
		if (!activeTest || !isActualGramsValid || !isNewRateInRange || !canWrite) return;

		const { requestId, seconds } = activeTest;
		setSaveError(null);

		startGuidedSave(async () => {
			try {
				const result = await saveCalibrationFromTest(
					deviceId,
					requestId,
					seconds,
					actualGrams,
					sessionId,
				);

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

		const nextRate = manualRate;
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
		<div className="space-y-5" data-help="calibration-form">
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
					id="calibration-tab-target"
					aria-selected={mode === "target"}
					aria-controls="calibration-panel-target"
					onClick={() => setMode("target")}
					className={cn(
						"flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors",
						mode === "target"
							? "bg-white text-[#0A3D62] shadow-sm dark:bg-gray-700 dark:text-gray-100"
							: "text-gray-600 hover:text-[#0A3D62] dark:text-gray-400 dark:hover:text-gray-200",
					)}
				>
					{t("tabTargetCheck")}
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

				<div className={calibrationFieldGrid}>
					<CalibrationNumberField
						id="calibration-test-seconds"
						label={t("guided.durationLabel")}
						unit="s"
						value={testSecondsInput}
						onValueChange={setTestSecondsInput}
						disabled={testLocked}
						help={t("guided.durationHelp")}
						{...TEST_SECONDS_RULES}
					/>
					<fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-1 xl:col-span-2">
						<legend className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300">
							{t("guided.presetsLabel")}
						</legend>
						<div className="flex min-h-11 flex-wrap items-center gap-2">
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
						</div>
					</fieldset>
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

						<div className={calibrationFieldGrid}>
							<div className="min-w-0 space-y-1">
								<CalibrationNumberField
									id="calibration-actual-grams"
									label={t("guided.actualGramsLabel")}
									unit="g"
									placeholder={t("guided.actualGramsPlaceholder")}
									value={actualGramsInput}
									onValueChange={setActualGramsInput}
									error={actualGramsError}
									{...ACTUAL_GRAMS_RULES}
								/>
								{isActualGramsValid && !isNewRateInRange && (
									<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
										{t("guided.rateOutOfRange", {
											rate: formatRate(newGramsPerSecond),
										})}
									</p>
								)}
							</div>

							<div className="min-w-0 sm:col-span-1 xl:col-span-2">
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
				id="calibration-panel-target"
				aria-labelledby="calibration-tab-target"
				hidden={mode !== "target"}
				className="space-y-4"
			>
				<p className="text-sm text-gray-600 dark:text-gray-300">{t("targetCheck.intro")}</p>

				<div className="flex items-center gap-2 rounded-xl border border-[#0A3D62]/10 bg-[#F4F7F6] px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60">
					<Target className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden="true" />
					<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
						{t("targetCheck.attemptBadge", {
							attempt: nextAttemptNumber,
							reTests: Math.max(0, nextAttemptNumber - 1),
						})}
					</p>
				</div>

				<div className={calibrationFieldGrid}>
					<CalibrationNumberField
						id="calibration-target-grams"
						label={t("targetCheck.targetLabel")}
						unit="g"
						value={targetInput}
						onValueChange={setTargetInput}
						disabled={targetLocked}
						help={t("targetCheck.targetHelp", {
							min: MIN_TARGET_G,
							max: MAX_TARGET_G,
							seconds: formatSeconds(targetExpectedSeconds),
						})}
						{...TARGET_GRAMS_RULES}
					/>

					<div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20 sm:col-span-1 xl:col-span-2">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
								{t("targetCheck.expectedDose")}
							</p>
							<p className="text-lg font-bold text-blue-900 dark:text-blue-100">
								{t("gramsValue", { grams: formatGrams(activeTargetGrams) })}
							</p>
						</div>
						<p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
							{t("targetCheck.feedWarning")}
						</p>
					</div>
				</div>

				{targetPhase !== "completed" && (
					<div className="space-y-2">
						<button
							type="button"
							onClick={handleRunTargetCheck}
							disabled={!canRunTargetCheck}
							className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
						>
							{isTargetPolling ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							) : (
								<Target className="h-4 w-4" aria-hidden="true" />
							)}
							{targetPhase === "queueing" ? t("targetCheck.queueing") : t("targetCheck.runButton")}
						</button>
						{targetBlockReason && (
							<p className="text-xs font-medium text-amber-700 dark:text-amber-400">
								{targetBlockReason}
							</p>
						)}
					</div>
				)}

				{(targetStatusMessage || targetError) && (
					<div
						aria-live="polite"
						aria-atomic="true"
						className={cn(
							"flex items-start gap-3 rounded-xl border p-4",
							targetPhase === "completed"
								? "border-[#1E7B34]/30 bg-[#1E7B34]/5 dark:border-green-900/50 dark:bg-green-900/20"
								: targetPhase === "expired" || targetPhase === "timeout" || targetPhase === "error"
									? "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
									: "border-[#0A3D62]/15 bg-[#F4F7F6] dark:border-gray-700 dark:bg-gray-800/60",
						)}
					>
						{isTargetPolling ? (
							<Loader2
								className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#0A3D62] dark:text-gray-300"
								aria-hidden="true"
							/>
						) : targetPhase === "completed" ? (
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
								{targetError ?? targetStatusMessage}
							</p>
							{targetPhase === "polling" && (
								<p className="text-xs text-gray-600 dark:text-gray-400">
									{t("guided.pollingNote")}
								</p>
							)}
							{(targetPhase === "expired" ||
								targetPhase === "timeout" ||
								targetPhase === "error") && (
								<>
									{(targetPhase === "expired" || targetPhase === "timeout") && (
										<p className="text-xs text-gray-600 dark:text-gray-400">
											{t("guided.expiredHelp")}
										</p>
									)}
									<button
										type="button"
										onClick={resetTargetCheck}
										className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-[#0A3D62]/20 bg-white px-4 text-sm font-semibold text-[#0A3D62] transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
									>
										{t("guided.runAnother")}
									</button>
								</>
							)}
						</div>
					</div>
				)}

				{targetPhase === "completed" && activeTargetCheck && (
					<div className="space-y-4 rounded-xl border border-[#0A3D62]/10 bg-[#F4F7F6] p-4 dark:border-gray-700 dark:bg-gray-800/60">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="flex items-center gap-2 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								<Scale className="h-4 w-4" aria-hidden="true" />
								{t("targetCheck.weighTitle")}
							</h3>
							<span className="rounded-full bg-[#0A3D62]/10 px-3 py-1 text-xs font-bold text-[#0A3D62] dark:bg-gray-700 dark:text-gray-200">
								{t("targetCheck.attemptBadge", {
									attempt: nextAttemptNumber,
									reTests: Math.max(0, nextAttemptNumber - 1),
								})}
							</span>
						</div>
						<p className="text-xs text-gray-600 dark:text-gray-400">
							{t("targetCheck.weighDesc", {
								target: formatGrams(activeTargetCheck.targetGrams),
							})}
						</p>

						<div className={calibrationFieldGrid}>
							<div className="min-w-0 space-y-1">
								<CalibrationNumberField
									id="calibration-target-measured"
									label={t("targetCheck.measuredLabel")}
									unit="g"
									placeholder={t("guided.actualGramsPlaceholder")}
									value={targetMeasuredInput}
									onValueChange={setTargetMeasuredInput}
									error={measuredGramsError}
									{...ACTUAL_GRAMS_RULES}
								/>
								{targetCorrectedOutOfRange && (
									<p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
										{t("targetCheck.rateOutOfRange", {
											rate: formatRate(targetCorrectedRate),
										})}
									</p>
								)}
							</div>

							<div className="min-w-0 sm:col-span-1 xl:col-span-2">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
									{t("guided.previewTitle")}
								</p>
								<dl className="mt-2 grid gap-3 sm:grid-cols-3">
									<div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
										<dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
											{t("targetCheck.expectedLabel")}
										</dt>
										<dd className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
											{t("gramsValue", { grams: formatGrams(activeTargetCheck.targetGrams) })}
										</dd>
									</div>
									<div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
										<dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
											{t("targetCheck.measuredLabel")}
										</dt>
										<dd className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
											{isTargetMeasuredValid
												? t("gramsValue", { grams: formatGrams(targetMeasuredGrams) })
												: "—"}
										</dd>
									</div>
									<div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-900">
										<dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
											{t("targetCheck.errorLabel")}
										</dt>
										<dd
											className={cn(
												"text-sm font-bold",
												!isTargetMeasuredValid
													? "text-[#0A3D62] dark:text-gray-100"
													: targetIsAccepted
														? "text-[#1E7B34] dark:text-green-300"
														: "text-[#C42B3A] dark:text-red-300",
											)}
										>
											{isTargetMeasuredValid
												? `${targetErrorPct >= 0 ? "+" : ""}${targetErrorPct.toFixed(1)}%`
												: "—"}
										</dd>
									</div>
								</dl>
								<p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
									{t("targetCheck.correctedRate", {
										rate: formatRate(targetCorrectedRate),
									})}
								</p>
							</div>
						</div>

						{isTargetMeasuredValid && (
							<div
								className={cn(
									"rounded-lg border px-4 py-3 text-sm",
									targetIsAccepted
										? "border-[#1E7B34]/30 bg-[#1E7B34]/5 text-[#1E7B34] dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
										: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300",
								)}
							>
								<p className="font-bold">
									{targetIsAccepted ? t("targetCheck.passTitle") : t("targetCheck.failTitle")}
								</p>
								<p className="mt-1 text-xs">
									{targetIsAccepted ? t("targetCheck.passHint") : t("targetCheck.failHint")}
								</p>
							</div>
						)}

						{targetSubmitError && (
							<p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
								{targetSubmitError}
							</p>
						)}

						<div className="flex flex-wrap gap-2">
							{targetIsAccepted ? (
								<button
									type="button"
									onClick={() => handleSubmitTargetCheck("save")}
									disabled={
										!canWrite ||
										!isTargetMeasuredValid ||
										targetCorrectedOutOfRange ||
										isTargetSubmitting
									}
									className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
								>
									{isTargetSubmitting && (
										<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
									)}
									{isTargetSubmitting ? t("targetCheck.saving") : t("targetCheck.saveButton")}
								</button>
							) : (
								<>
									<button
										type="button"
										onClick={() => handleSubmitTargetCheck("retest")}
										disabled={
											!canWrite ||
											!isTargetMeasuredValid ||
											targetCorrectedOutOfRange ||
											isTargetSubmitting
										}
										className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-6 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
									>
										{isTargetSubmitting && (
											<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
										)}
										{isTargetSubmitting ? t("targetCheck.saving") : t("targetCheck.retestButton")}
									</button>
									<button
										type="button"
										onClick={() => handleSubmitTargetCheck("save_anyway")}
										disabled={
											!canWrite ||
											!isTargetMeasuredValid ||
											targetCorrectedOutOfRange ||
											isTargetSubmitting
										}
										className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-center rounded-xl border border-[#0A3D62]/20 bg-white px-6 text-sm font-bold text-[#0A3D62] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 sm:w-auto"
									>
										{t("targetCheck.saveAnywayButton")}
									</button>
								</>
							)}
						</div>
					</div>
				)}

				{targetResult && (
					<section
						aria-live="polite"
						className="rounded-xl border border-[#1E7B34]/25 bg-[#1E7B34]/5 p-4 dark:border-green-900/50 dark:bg-green-900/20"
					>
						<p className="text-xs font-bold uppercase tracking-wide text-[#1E7B34] dark:text-green-300">
							{targetResult.saved ? t("targetCheck.savedTitle") : t("targetCheck.correctionTitle")}
						</p>
						<p className="mt-2 text-sm font-medium text-gray-800 dark:text-gray-100">
							{t("targetCheck.resultSummary", {
								attempt: targetResult.attempt ?? 1,
								reTests: targetResult.reTests ?? 0,
								error:
									targetResult.errorPct === undefined
										? "—"
										: `${targetResult.errorPct >= 0 ? "+" : ""}${targetResult.errorPct.toFixed(1)}%`,
								rate: formatRate(targetResult.correctedGramsPerSecond ?? 0),
							})}
						</p>
						<p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
							{targetResult.accepted ? t("targetCheck.accepted") : t("targetCheck.notAccepted")}
						</p>
					</section>
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

				<div className={calibrationFieldGrid}>
					<CalibrationNumberField
						id="calibration-manual-rate"
						label={t("manual.rateLabel")}
						unit="g/s"
						value={manualRateInput}
						onValueChange={setManualRateInput}
						help={t("manual.rateHelp")}
						{...MANUAL_RATE_RULES}
					/>

					<div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-900/20 sm:col-span-1 xl:col-span-2">
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
