"use client";

import { Link } from "@/i18n/routing";
import { applyPredictedGrams } from "@/lib/actions/prediction";
import { ApiClientError, apiPost } from "@/lib/api-client";
import type {
	FeedingPrediction,
	PredictionClampReason,
	PredictionConfidence,
	PredictionConfidenceReason,
	PredictionSafety,
} from "@/lib/prediction";
import {
	AlertTriangle,
	ArrowRight,
	Brain,
	Calculator,
	Check,
	CheckCircle2,
	ChevronDown,
	Clock3,
	Fish,
	Info,
	Lock,
	Minus,
	Plus,
	RefreshCw,
	RotateCcw,
	Scale,
	ShieldCheck,
	Sparkles,
	TrendingDown,
	TrendingUp,
	Wheat,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface FeedingPredictionCardProps {
	deviceId: string;
	initialPrediction: FeedingPrediction;
	canWrite: boolean;
	pondName: string;
}

interface AppliedState {
	grams: number;
	previousGrams?: number;
	at: string;
}

const confidenceVisuals: Record<
	PredictionConfidence,
	{ pct: number; ring: string; chip: string; dot: string }
> = {
	high: {
		pct: 92,
		ring: "#16a34a",
		chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
		dot: "bg-emerald-500",
	},
	medium: {
		pct: 65,
		ring: "#f0a202",
		chip: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
		dot: "bg-amber-500",
	},
	low: {
		pct: 35,
		ring: "#9ca3af",
		chip: "bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300",
		dot: "bg-gray-400",
	},
};

const clampReasonOrder: PredictionClampReason[] = [
	"deviceLimit",
	"deviationBand",
	"baselineBand",
	"minimum",
];

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Re-centres the visible safety envelope after the device value changes. */
function safetyForCurrent(safety: PredictionSafety, currentGrams: number): PredictionSafety {
	const threshold = safety.deviationThresholdPct / 100;
	const min = Math.max(1, currentGrams * (1 - threshold));
	const max = Math.min(safety.upperBoundGrams, currentGrams * (1 + threshold));
	return {
		...safety,
		minGrams: round1(Math.min(min, max)),
		maxGrams: round1(max),
	};
}

export function FeedingPredictionCard({
	deviceId,
	initialPrediction,
	canWrite,
	pondName,
}: FeedingPredictionCardProps) {
	const t = useTranslations("dashboard.growth.prediction");
	const locale = useLocale();
	const [prediction, setPrediction] = useState<FeedingPrediction>(initialPrediction);
	const [draftGrams, setDraftGrams] = useState(initialPrediction.grams ?? 1);
	const [applied, setApplied] = useState<AppliedState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [cooldown, setCooldown] = useState(0);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const [isRefreshing, startRefresh] = useTransition();
	const [isApplying, startApply] = useTransition();
	const autoRefineStarted = useRef(false);

	const grams = prediction.grams;
	const current = prediction.currentGrams;
	const safety = prediction.safety;
	const factors = prediction.factors;
	const confidence = confidenceVisuals[prediction.confidence];
	const hasValue = grams !== null;
	const rangeMin = safety.minGrams;
	const rangeMax = Math.max(safety.maxGrams, rangeMin);
	const sliderDisabled = !canWrite || !hasValue || isApplying || rangeMax <= rangeMin;
	const draft = clamp(round1(draftGrams), rangeMin, rangeMax);
	const differsFromRecommendation = grams !== null && Math.abs(draft - grams) >= 0.05;
	const matchesCurrent = current !== null && Math.abs(draft - current) < 0.05;
	const delta = grams !== null && current !== null && current > 0 ? grams - current : null;

	const refresh = useCallback(
		(silent = false) => {
			if (isRefreshing) return;
			if (!silent && cooldown > 0) return;
			setError(null);
			startRefresh(async () => {
				try {
					const data = await apiPost<FeedingPrediction>("/api/predict-feeding", undefined, {
						timeoutMs: 15_000,
					});
					setPrediction(data);
					setApplied(null);
					setError(null);
					if (!silent) setCooldown(8);
				} catch (caught) {
					if (silent) return;
					const message = caught instanceof ApiClientError ? caught.message : t("refreshError");
					setError(message);
				}
			});
		},
		[cooldown, isRefreshing, t],
	);

	// The server renders the deterministic value instantly. Refine it once in
	// the background so the page never waits on the AI provider.
	useEffect(() => {
		if (autoRefineStarted.current) return;
		autoRefineStarted.current = true;
		if (initialPrediction.source !== "deterministic" || initialPrediction.grams === null) {
			return;
		}
		refresh(true);
	}, [initialPrediction.grams, initialPrediction.source, refresh]);

	useEffect(() => {
		if (prediction.grams !== null) setDraftGrams(prediction.grams);
	}, [prediction.grams]);

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	useEffect(() => {
		const timer = setInterval(() => setNowMs(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);

	const stepDraft = (deltaGrams: number) => {
		setDraftGrams((value) => clamp(round1(value + deltaGrams), rangeMin, rangeMax));
	};

	const apply = () => {
		if (!canWrite || isApplying || !hasValue) return;
		const value = clamp(round1(draftGrams), rangeMin, rangeMax);
		if (current !== null && Math.abs(value - current) < 0.05) return;
		setError(null);
		startApply(async () => {
			const result = await applyPredictedGrams(deviceId, value, {
				source: prediction.source,
				confidence: prediction.confidence,
				baselineGrams: prediction.baselineGrams,
			});
			if (result.success) {
				const newGrams = result.newGrams ?? value;
				setApplied({
					grams: newGrams,
					previousGrams: result.previousGrams,
					at: result.appliedAt ?? new Date().toISOString(),
				});
				setPrediction((previous) => ({
					...previous,
					currentGrams: newGrams,
					safety: safetyForCurrent(previous.safety, newGrams),
				}));
				setDraftGrams(newGrams);
				toast.success(t("appliedToast", { grams: newGrams.toFixed(1) }));
			} else {
				setError(result.error ?? t("applyError"));
				toast.error(result.error ?? t("applyError"));
			}
		});
	};

	const restore = () => {
		if (!applied?.previousGrams || isApplying) return;
		const value = applied.previousGrams;
		setError(null);
		startApply(async () => {
			const result = await applyPredictedGrams(deviceId, value);
			if (result.success) {
				setPrediction((previous) => ({
					...previous,
					currentGrams: value,
					safety: safetyForCurrent(previous.safety, value),
				}));
				setDraftGrams(value);
				setApplied(null);
				toast.success(t("restoreSuccess"));
			} else {
				setError(result.error ?? t("restoreError"));
				toast.error(result.error ?? t("restoreError"));
			}
		});
	};

	const formatUpdated = (iso: string): string => {
		const timestamp = new Date(iso).getTime();
		if (!Number.isFinite(timestamp)) return "";
		const minutes = Math.max(0, Math.round((nowMs - timestamp) / 60_000));
		if (minutes < 1) return t("justNow");
		if (minutes < 60) return t("minutesAgo", { minutes });
		const hours = Math.round(minutes / 60);
		if (hours < 24) return t("hoursAgo", { hours });
		return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
			new Date(timestamp),
		);
	};

	const formatTime = (iso: string): string => {
		const date = new Date(iso);
		if (!Number.isFinite(date.getTime())) return "";
		return new Intl.DateTimeFormat(locale, {
			hour: "2-digit",
			minute: "2-digit",
		}).format(date);
	};

	const rangeSpan = Math.max(0.1, rangeMax - rangeMin);
	const position = (value: number): number =>
		rangeMax <= rangeMin ? 50 : clamp(((value - rangeMin) / rangeSpan) * 100, 0, 100);

	const confidenceReasonLabel = (reason: PredictionConfidenceReason): string => {
		if (reason === "sampleFresh" || reason === "sampleAging" || reason === "sampleStale") {
			return t(`confidenceReason_${reason}`, { days: factors.sampleAgeDays ?? 0 });
		}
		return t(`confidenceReason_${reason}`);
	};

	return (
		<section
			aria-labelledby="ai-feed-advisor-title"
			className="overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900"
		>
			<header className="relative overflow-hidden bg-gradient-to-br from-[#0A3D62] via-[#0c4a73] to-[#08324f] px-5 py-5 text-white sm:px-6">
				<div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/5" />
				<div className="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-[#FF6B35]/10" />
				<div className="pointer-events-none absolute -left-10 bottom-0 h-24 w-24 rounded-full bg-white/5" />

				<div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex items-start gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
							<Brain className="h-6 w-6" />
						</div>
						<div>
							<p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200/80">
								{t("eyebrow")}
							</p>
							<h2 id="ai-feed-advisor-title" className="text-lg font-black leading-tight">
								{t("title")}
							</h2>
							<p className="mt-0.5 text-xs font-medium text-blue-100/80">
								{t("subtitle", { pond: pondName })}
							</p>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2 sm:justify-end">
						<span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ring-white/10">
							{prediction.source === "ai" ? (
								<>
									<Sparkles className="h-3 w-3 text-[#FFB38A]" />
									{t("sourceAi")}
								</>
							) : (
								<>
									<Calculator className="h-3 w-3 text-blue-200" />
									{t("sourceFormula")}
								</>
							)}
						</span>
						{prediction.cached && (
							<span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ring-white/10">
								{t("cached")}
							</span>
						)}
						<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-100/70">
							<Clock3 className="h-3 w-3" />
							{formatUpdated(prediction.generatedAt)}
						</span>
						<button
							type="button"
							onClick={() => refresh(false)}
							disabled={isRefreshing || cooldown > 0}
							aria-label={t("refresh")}
							className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/10 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
							<span>
								{isRefreshing
									? t("refreshing")
									: cooldown > 0
										? t("refreshCooldown", { seconds: cooldown })
										: t("refresh")}
							</span>
						</button>
					</div>
				</div>
			</header>

			<div className="space-y-6 p-5 sm:p-6">
				{error && (
					<div
						role="alert"
						className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"
					>
						<span className="flex items-start gap-2">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{error}</span>
						</span>
						<button
							type="button"
							onClick={() => refresh(false)}
							disabled={isRefreshing || cooldown > 0}
							className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900/40"
						>
							{t("retry")}
						</button>
					</div>
				)}

				{!hasValue ? (
					<div className="flex flex-col items-center gap-5 py-6 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
							<Fish className="h-8 w-8" />
						</div>
						<div className="max-w-lg">
							<h3 className="text-lg font-black text-gray-900 dark:text-gray-100">
								{t("noDataTitle")}
							</h3>
							<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("noData")}</p>
						</div>
						<ol className="grid w-full max-w-xl gap-2 text-left text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-3">
							{[t("noDataStep1"), t("noDataStep2"), t("noDataStep3")].map((step, index) => (
								<li
									key={step}
									className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/50"
								>
									<span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#0A3D62] text-[10px] font-black text-white">
										{index + 1}
									</span>
									<span className="text-xs font-medium leading-relaxed">{step}</span>
								</li>
							))}
						</ol>
						<Link
							href="/dashboard/log-sample"
							className="inline-flex items-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0] dark:hover:bg-[#164e7c]"
						>
							<Scale className="h-4 w-4" />
							{t("logSample")}
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
				) : (
					<>
						<div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
							<div className="rounded-3xl border border-gray-100 bg-gradient-to-br from-gray-50 via-white to-gray-50 p-5 dark:border-gray-700/60 dark:from-gray-800/60 dark:via-gray-900 dark:to-gray-800/40">
								<div className="flex flex-wrap items-end justify-between gap-3">
									<div>
										<p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
											{t("predictedLabel")}
										</p>
										<div className="mt-1 flex items-end gap-2">
											<p className="text-5xl font-black leading-none tracking-tight text-[var(--ofd-base-deep)]">
												{grams.toFixed(1)}
											</p>
											<span className="pb-1 text-lg font-bold text-gray-400 dark:text-gray-500">
												g
											</span>
										</div>
										<p className="mt-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
											{t("perFeeding")}
										</p>
									</div>

									<div className="flex flex-col items-start gap-1.5 sm:items-end">
										{delta !== null && Math.abs(delta) >= 0.05 ? (
											<span
												className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
													delta >= 0
														? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
														: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300"
												}`}
											>
												{delta >= 0 ? (
													<TrendingUp className="h-3.5 w-3.5" />
												) : (
													<TrendingDown className="h-3.5 w-3.5" />
												)}
												{delta >= 0 ? "+" : ""}
												{delta.toFixed(1)} g {t("vsCurrent")}
											</span>
										) : (
											<span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600 dark:bg-gray-700/60 dark:text-gray-300">
												<Check className="h-3.5 w-3.5" />
												{t("matchesCurrent")}
											</span>
										)}
										{current !== null && (
											<p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">
												{t("currentLabel")}: {current.toFixed(1)} g
											</p>
										)}
									</div>
								</div>

								<div className="mt-6">
									<div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
										<span>{t("safeEnvelope")}</span>
										<span>
											{rangeMin.toFixed(1)}–{rangeMax.toFixed(1)} g
										</span>
									</div>
									<div className="relative mt-5 h-3 rounded-full bg-gradient-to-r from-sky-100 via-emerald-100 to-amber-100 dark:from-sky-950 dark:via-emerald-950 dark:to-amber-950">
										{current !== null && (
											<div
												className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#0A3D62] shadow-sm dark:border-gray-900 dark:bg-[#5b9bd5]"
												style={{ left: `${position(current)}%` }}
												aria-hidden="true"
											/>
										)}
										<div
											className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#FF6B35] shadow-md ring-2 ring-[#FF6B35]/20 dark:border-gray-900"
											style={{ left: `${position(grams)}%` }}
											aria-hidden="true"
										/>
									</div>
									<div className="mt-4 flex items-center justify-between gap-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
										<span className="inline-flex items-center gap-1.5">
											<span className="h-2.5 w-2.5 rounded-full bg-[#0A3D62] dark:bg-[#5b9bd5]" />
											{t("currentMarker")}
										</span>
										<span className="inline-flex items-center gap-1.5">
											<span className="h-2.5 w-2.5 rounded-full bg-[#FF6B35]" />
											{t("recommendedMarker")}
										</span>
									</div>
								</div>

								<div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
									<div className="rounded-2xl border border-gray-100 bg-white/80 p-3 dark:border-gray-700/60 dark:bg-gray-900/60">
										<p className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("currentSchedule")}
										</p>
										<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
											{current !== null ? `${current.toFixed(1)} g` : "—"}
										</p>
									</div>
									<div className="rounded-2xl border border-gray-100 bg-white/80 p-3 dark:border-gray-700/60 dark:bg-gray-900/60">
										<p className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("mealsPerDay")}
										</p>
										<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
											{factors.feedsPerDay || "—"}
										</p>
									</div>
									<div className="rounded-2xl border border-gray-100 bg-white/80 p-3 dark:border-gray-700/60 dark:bg-gray-900/60">
										<p className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("dailyTotal")}
										</p>
										<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
											{factors.dailyFeedG !== null ? `${factors.dailyFeedG.toFixed(1)} g` : "—"}
										</p>
									</div>
									<div className="rounded-2xl border border-gray-100 bg-white/80 p-3 dark:border-gray-700/60 dark:bg-gray-900/60">
										<p className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("lastSample")}
										</p>
										<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
											{factors.sampleAgeDays !== null
												? t("daysAgo", { days: factors.sampleAgeDays })
												: "—"}
										</p>
									</div>
								</div>
							</div>

							<div className="space-y-3">
								<div className="rounded-3xl border border-gray-100 bg-white p-5 dark:border-gray-700/60 dark:bg-gray-900">
									<div className="flex items-center justify-between gap-3">
										<p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
											{t("confidence")}
										</p>
										<span
											className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${confidence.chip}`}
										>
											{t(`confidence_${prediction.confidence}`)}
										</span>
									</div>
									<div className="mt-4 flex items-center gap-4">
										<div
											className="relative h-20 w-20 shrink-0 rounded-full"
											style={{
												background: `conic-gradient(${confidence.ring} ${confidence.pct}%, rgba(148, 163, 184, 0.18) 0)`,
											}}
											role="img"
											aria-label={`${t("confidence")}: ${t(`confidence_${prediction.confidence}`)}`}
										>
											<div className="absolute inset-[7px] flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-900">
												<span className="text-xl font-black text-gray-900 dark:text-gray-100">
													{confidence.pct}%
												</span>
												<span className="text-[8px] font-black uppercase tracking-wider text-gray-400">
													{t("score")}
												</span>
											</div>
										</div>
										<p className="text-xs font-medium leading-relaxed text-gray-500 dark:text-gray-400">
											{t(`confidenceHint_${prediction.confidence}`)}
										</p>
									</div>
									<ul className="mt-4 space-y-1.5">
										{prediction.confidenceReasons.map((reason) => (
											<li
												key={reason}
												className="flex items-start gap-2 text-[11px] font-medium text-gray-500 dark:text-gray-400"
											>
												<span
													className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
														reason === "aiConfidenceCapped" ? "bg-amber-400" : confidence.dot
													}`}
												/>
												{confidenceReasonLabel(reason)}
											</li>
										))}
									</ul>
								</div>

								<div className="rounded-3xl border border-[#0A3D62]/10 bg-[#0A3D62]/[0.03] p-4 dark:border-white/10 dark:bg-white/5">
									<div className="flex items-start gap-2.5">
										<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0A3D62] dark:text-[#5b9bd5]" />
										<div>
											<p className="text-xs font-black text-[#0A3D62] dark:text-[#9cc7f0]">
												{t("safetyTitle")}
											</p>
											<p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
												{t("safetyDesc")}
											</p>
											<p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-bold text-gray-600 shadow-sm dark:bg-gray-900 dark:text-gray-300">
												<Lock className="h-3 w-3" />
												{safety.clamped ? t("safetyClamped") : t("safetyNotClamped")}
											</p>
											{safety.clamped && (
												<div className="mt-2 flex flex-wrap gap-1.5">
													{clampReasonOrder
														.filter((reason) => safety.clampReasons.includes(reason))
														.map((reason) => (
															<span
																key={reason}
																className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
															>
																{t(`safetyClamp_${reason}`, {
																	pct: safety.deviationThresholdPct,
																})}
															</span>
														))}
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						</div>

						<details className="group rounded-3xl border border-gray-100 bg-gray-50/60 dark:border-gray-700/60 dark:bg-gray-800/40">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
								<span className="flex items-center gap-2 text-sm font-black text-gray-800 dark:text-gray-100">
									<Info className="h-4 w-4 text-[#0A3D62] dark:text-[#5b9bd5]" />
									{t("whyTitle")}
								</span>
								<ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
							</summary>
							<div className="grid gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-700/60 sm:grid-cols-2">
								<div className="flex items-start gap-2.5">
									<Fish className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
									<div>
										<p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("whyBiomass")}
										</p>
										<p className="mt-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
											{factors.population !== null && factors.avgWeightKg !== null
												? t("biomassValue", {
														count: factors.population,
														weight: (factors.avgWeightKg * 1000).toFixed(1),
														biomass: factors.biomassKg?.toFixed(2) ?? "—",
													})
												: t("biomassUnknown")}
										</p>
									</div>
								</div>

								<div className="flex items-start gap-2.5">
									<Calculator className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
									<div>
										<p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("whyBaseline")}
										</p>
										<p className="mt-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
											{t("baselineValue", {
												rate: factors.feedingRatePct,
												feeds: factors.feedsPerDay,
												grams: factors.baselineGrams?.toFixed(1) ?? "—",
											})}
										</p>
									</div>
								</div>

								<div className="flex items-start gap-2.5">
									<Wheat className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
									<div>
										<p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("whyFcr")}
										</p>
										<p className="mt-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
											{factors.latestFcr !== null
												? t("fcrValue", {
														pct:
															factors.fcrAdjustmentPct > 0
																? `+${factors.fcrAdjustmentPct.toFixed(1)}`
																: factors.fcrAdjustmentPct.toFixed(1),
														fcr: factors.latestFcr.toFixed(2),
														ref: factors.referenceFcr,
													})
												: t("fcrNone")}
										</p>
									</div>
								</div>

								<div className="flex items-start gap-2.5">
									<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
									<div>
										<p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
											{t("whySafety")}
										</p>
										<p className="mt-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
											{t("safetyValue", {
												min: rangeMin.toFixed(1),
												max: rangeMax.toFixed(1),
											})}
										</p>
									</div>
								</div>

								<div className="sm:col-span-2 rounded-2xl border border-gray-100 bg-white p-3.5 dark:border-gray-700/60 dark:bg-gray-900/60">
									<p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
										{prediction.source === "ai" ? (
											<Sparkles className="h-3 w-3 text-[#FF6B35]" />
										) : (
											<Calculator className="h-3 w-3 text-blue-500" />
										)}
										{prediction.source === "ai" ? t("aiReasoning") : t("formulaReasoning")}
									</p>
									<p className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
										{prediction.reasoning}
									</p>
								</div>
							</div>
						</details>

						{applied ? (
							<div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div className="flex items-start gap-3">
										<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
										<div>
											<p className="text-sm font-black text-emerald-800 dark:text-emerald-200">
												{t("appliedTitle")}
											</p>
											<p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
												{t("appliedDesc", { grams: applied.grams.toFixed(1) })}
											</p>
											<p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600/80 dark:text-emerald-400/80">
												{t("appliedAt", { time: formatTime(applied.at) })}
											</p>
										</div>
									</div>
									{applied.previousGrams !== undefined && canWrite && (
										<button
											type="button"
											onClick={restore}
											disabled={isApplying}
											className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
										>
											<RotateCcw className="h-3.5 w-3.5" />
											{isApplying
												? t("restoring")
												: t("restore", { grams: applied.previousGrams.toFixed(1) })}
										</button>
									)}
								</div>
							</div>
						) : (
							<div className="rounded-3xl border border-gray-100 bg-white p-4 dark:border-gray-700/60 dark:bg-gray-900 sm:p-5">
								<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
									<div>
										<p className="text-sm font-black text-gray-900 dark:text-gray-100">
											{t("fineTune")}
										</p>
										<p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
											{t("fineTuneDesc")}
										</p>
									</div>
									{differsFromRecommendation && grams !== null && (
										<button
											type="button"
											onClick={() => setDraftGrams(grams)}
											className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-[#0A3D62] hover:bg-[#0A3D62]/5 dark:text-[#5b9bd5] dark:hover:bg-white/5"
										>
											<RotateCcw className="h-3 w-3" />
											{t("reset")}
										</button>
									)}
								</div>

								<div className="mt-4 flex items-center gap-3">
									<button
										type="button"
										onClick={() => stepDraft(-0.5)}
										disabled={sliderDisabled || draft <= rangeMin}
										aria-label={t("decrease")}
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
									>
										<Minus className="h-4 w-4" />
									</button>
									<div className="min-w-0 flex-1">
										<input
											type="range"
											min={rangeMin}
											max={rangeMax}
											step={0.5}
											value={draft}
											disabled={sliderDisabled}
											onChange={(event) =>
												setDraftGrams(clamp(round1(Number(event.target.value)), rangeMin, rangeMax))
											}
											aria-label={t("fineTune")}
											aria-valuetext={`${draft.toFixed(1)} g`}
											className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-[#FF6B35] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700"
										/>
										<div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-gray-400 dark:text-gray-500">
											<span>{rangeMin.toFixed(1)} g</span>
											<span>{rangeMax.toFixed(1)} g</span>
										</div>
									</div>
									<button
										type="button"
										onClick={() => stepDraft(0.5)}
										disabled={sliderDisabled || draft >= rangeMax}
										aria-label={t("increase")}
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
									>
										<Plus className="h-4 w-4" />
									</button>
								</div>

								{!canWrite && (
									<div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
										<Lock className="mt-0.5 h-4 w-4 shrink-0" />
										{t("readOnly")}
									</div>
								)}

								<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
									<button
										type="button"
										onClick={apply}
										disabled={!canWrite || isApplying || matchesCurrent}
										className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0A3D62] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#1f66a0] dark:hover:bg-[#164e7c]"
									>
										<Check className="h-4 w-4" />
										{isApplying
											? t("applying")
											: matchesCurrent
												? t("alreadyCurrent")
												: t("applyValue", { grams: draft.toFixed(1) })}
									</button>
									<p className="text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
										{t("disclaimer")}
									</p>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</section>
	);
}
