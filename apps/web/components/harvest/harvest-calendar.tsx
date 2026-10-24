"use client";

import { Link, useRouter } from "@/i18n/routing";
import { cancelCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { completePondEvent, updatePondEvent } from "@/lib/actions/pond-event";
import { ApiClientError, apiGet } from "@/lib/api-client";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { CALENDAR_EVENT_TYPES, isCalendarEventType } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays, daysBetween, todayDateOnly } from "@/lib/crop-cycle/dates";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import {
	CalendarDays,
	Check,
	ChevronRight,
	CircleAlert,
	CloudOff,
	ExternalLink,
	Filter,
	Fish,
	Loader2,
	PauseCircle,
	Plus,
	RefreshCw,
	Scale,
	Sparkles,
	Wheat,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarErrorBoundary } from "./calendar-error-boundary";
import { CycleForm } from "./cycle-form";
import { EventForm } from "./event-form";
import { HarvestForm } from "./harvest-form";
import { Modal } from "./modal";

const CalendarView = dynamic(
	() => import("./calendar-view").then((module) => module.CalendarView),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-80 items-center justify-center rounded-3xl border border-gray-100 bg-gray-50/60 dark:border-gray-700/60 dark:bg-gray-800/40">
				<Loader2 className="h-6 w-6 animate-spin text-[#0A3D62] dark:text-[#5b9bd5]" />
			</div>
		),
	},
);

interface HarvestCalendarProps {
	initialPondId: string;
	initialPondName: string;
	initialPondIsFallow: boolean;
	ponds: PondOption[];
	activeCycle: CropCycleDto | null;
	activeCycles: CropCycleDto[];
	recentCycles: CropCycleDto[];
	canManage: boolean;
	today: string;
}

const defaultTypes: CalendarEventType[] = ["harvest", "sampling", "manual", "device"];

/** Format an event start for the detail drawer without timezone drift. */
function formatEventMoment(event: CalendarEventDto, locale: string): string {
	const raw = event.start;
	let instant: Date | null = null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		instant = new Date(`${raw}T00:00:00+08:00`);
	} else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
		// Feeding/manual times are farm-local naive timestamps.
		instant = new Date(`${raw}+08:00`);
	} else {
		const parsed = new Date(raw);
		instant = Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	if (!instant) return raw.slice(0, 10);

	const options: Intl.DateTimeFormatOptions = {
		dateStyle: "medium",
		timeZone: FARM_TIME_ZONE,
	};
	if (!event.allDay) options.timeStyle = "short";
	return new Intl.DateTimeFormat(locale, options).format(instant);
}

function cycleToInput(cycle: CropCycleDto, overrides: Partial<CropCycleDto> = {}) {
	const value = { ...cycle, ...overrides };
	return {
		pondId: value.pondId,
		label: value.label,
		stockingDate: value.stockingDate,
		stockingCount: value.stockingCount,
		stockingAvgWeightG: value.stockingAvgWeightG,
		growOutDays: value.growOutDays,
		targetHarvestDate: value.targetHarvestDate,
		targetHarvestWeightG: value.targetHarvestWeightG,
		expectedSurvivalPct: value.expectedSurvivalPct,
		notes: value.notes,
	};
}

export function HarvestCalendar({
	initialPondId,
	initialPondName,
	initialPondIsFallow,
	ponds,
	activeCycle,
	activeCycles,
	recentCycles,
	canManage,
	today,
}: HarvestCalendarProps) {
	const t = useTranslations("dashboard.harvest");
	const tNav = useTranslations("nav");
	const locale = useLocale();
	const router = useRouter();
	const requestId = useRef(0);
	const [selectedPondId, setSelectedPondId] = useState(initialPondId);
	const [allPonds, setAllPonds] = useState(false);
	const [types, setTypes] = useState<Set<CalendarEventType>>(new Set(defaultTypes));
	const [range, setRange] = useState({ from: addDays(today, -14), to: addDays(today, 45) });
	const [viewType, setViewType] = useState("dayGridMonth");
	const [events, setEvents] = useState<CalendarEventDto[]>([]);
	const [upcomingEvents, setUpcomingEvents] = useState<CalendarEventDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [truncated, setTruncated] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const [cycleFormOpen, setCycleFormOpen] = useState(false);
	const [editingCycle, setEditingCycle] = useState<CropCycleDto | null>(null);
	const [harvestOpen, setHarvestOpen] = useState(false);
	const [eventFormOpen, setEventFormOpen] = useState(false);
	const [eventDate, setEventDate] = useState(today);
	const [editingEvent, setEditingEvent] = useState<CalendarEventDto | null>(null);
	const [details, setDetails] = useState<CalendarEventDto | null>(null);
	const [isCancelling, startCancel] = useTransition();
	const [isCompleting, startComplete] = useTransition();
	const urlHydrated = useRef(false);

	const cycleForPond = useCallback(
		(pondId: string): CropCycleDto | null =>
			activeCycles.find((cycle) => cycle.pondId === pondId) ??
			(pondId === initialPondId ? activeCycle : null),
		[activeCycles, activeCycle, initialPondId],
	);
	const selectedPond = ponds.find((pond) => pond.id === selectedPondId);
	const selectedCycle = cycleForPond(selectedPondId);
	const metrics = selectedCycle ? computeCropCycleMetrics(selectedCycle, today) : null;
	const isFallow = selectedPond?.isFallow ?? initialPondIsFallow;
	const typesKey = useMemo(() => [...types].sort().join(","), [types]);

	// Restore the pond/all-ponds/event-type selection from the URL once, then
	// keep the URL in sync without triggering a navigation.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const pondParam = params.get("pond");
		if (pondParam === "all") {
			setAllPonds(true);
		} else if (pondParam && ponds.some((pond) => pond.id === pondParam)) {
			setSelectedPondId(pondParam);
			setAllPonds(false);
		}
		const typeParam = params.get("types");
		if (typeParam) {
			const parsed = typeParam.split(",").filter(isCalendarEventType);
			if (parsed.length > 0) setTypes(new Set(parsed));
		}
		urlHydrated.current = true;
	}, [ponds]);

	useEffect(() => {
		if (!urlHydrated.current) return;
		const params = new URLSearchParams();
		params.set("pond", allPonds ? "all" : selectedPondId);
		params.set("types", typesKey);
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}, [allPonds, selectedPondId, typesKey]);

	const detailCycle = details ? cycleForPond(details.pondId) : null;
	const canEditDetails = Boolean(
		details?.editable && canManage && (details.kind === "MAINTENANCE" || details.kind === "OTHER"),
	);
	const canRescheduleDetails = Boolean(
		details && details.kind === "HARVEST_PLANNED" && canManage && detailCycle,
	);
	const selectedRecentCycles = recentCycles
		.filter((cycle) => cycle.pondId === selectedPondId)
		.slice(0, 3);
	const canCompleteDetails = canEditDetails && details?.status !== "done";

	const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

	// The upcoming strip is independent of the visible calendar range. Without
	// this separate query, browsing a past week would incorrectly show "no
	// upcoming events" and browsing a future month would hide this week's work.
	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({
			from: today,
			to: addDays(today, 45),
			pondId: allPonds ? "all" : selectedPondId,
			types: typesKey,
			refresh: String(refreshKey),
		});

		apiGet<{ events: CalendarEventDto[] }>(`/api/calendar/events?${params.toString()}`, {
			timeoutMs: 10_000,
			signal: controller.signal,
		})
			.then((data) => {
				if (!controller.signal.aborted) setUpcomingEvents(data.events);
			})
			.catch(() => {
				// The calendar error banner is authoritative; keep the last good
				// upcoming list rather than replacing it with a second error.
			});

		return () => controller.abort();
	}, [allPonds, selectedPondId, typesKey, refreshKey, today]);

	useEffect(() => {
		const controller = new AbortController();
		const currentRequest = ++requestId.current;
		let cancelled = false;
		setLoading(true);
		setError(null);
		setTruncated(false);

		const params = new URLSearchParams({
			from: range.from,
			to: range.to,
			pondId: allPonds ? "all" : selectedPondId,
			types: typesKey,
			refresh: String(refreshKey),
		});

		apiGet<{ events: CalendarEventDto[]; truncated: boolean }>(
			`/api/calendar/events?${params.toString()}`,
			{ timeoutMs: 10_000, signal: controller.signal },
		)
			.then((data) => {
				if (cancelled || currentRequest !== requestId.current) return;
				setEvents(data.events);
				setTruncated(Boolean(data.truncated));
			})
			.catch((caught) => {
				if (cancelled || currentRequest !== requestId.current || controller.signal.aborted) return;
				setError(caught instanceof ApiClientError ? caught.message : t("calendar.loadError"));
			})
			.finally(() => {
				if (!cancelled && currentRequest === requestId.current) setLoading(false);
			});

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [allPonds, range.from, range.to, selectedPondId, t, typesKey, refreshKey]);

	const labelFor = (event: CalendarEventDto): string => {
		if (event.kind === "STOCKING") {
			return t("event.stocking", { label: event.cycleLabel ?? event.pondName });
		}
		if (event.kind === "HARVEST_PLANNED") {
			return t("event.harvestPlanned", { label: event.cycleLabel ?? event.pondName });
		}
		if (event.kind === "HARVEST_ACTUAL") {
			return t("event.harvestActual", { label: event.cycleLabel ?? event.pondName });
		}
		if (event.type === "sampling") return t("event.sampling");
		if (event.type === "feeding") return t("event.feeding");
		return event.title;
	};

	const toggleType = (type: CalendarEventType) => {
		setTypes((current) => {
			const next = new Set(current);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			return next.size === 0 ? new Set(defaultTypes) : next;
		});
	};

	const openNewCycle = () => {
		setEditingCycle(null);
		setCycleFormOpen(true);
	};

	const openEditCycle = (cycle: CropCycleDto) => {
		setEditingCycle(cycle);
		setCycleFormOpen(true);
	};

	const handleEventClick = (event: CalendarEventDto) => {
		setDetails(event);
	};

	const openEventEditor = () => {
		if (!details || !canEditDetails) return;
		setEditingEvent(details);
		setDetails(null);
		setEventFormOpen(true);
	};

	const openCycleEditorFromDetails = () => {
		if (!detailCycle || !canRescheduleDetails) return;
		setDetails(null);
		openEditCycle(detailCycle);
	};

	const markEventDone = () => {
		if (!details || !canCompleteDetails || isCompleting) return;
		const id = details.id.replace(/^pond:/, "");
		startComplete(async () => {
			const result = await completePondEvent({ id });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("eventForm.successUpdate"));
			setDetails(null);
			router.refresh();
			refresh();
		});
	};

	const handleDateClick = (date: string) => {
		if (!canManage || allPonds) return;
		setEditingEvent(null);
		setEventDate(date);
		setEventFormOpen(true);
	};

	const handleEventDrop = async (event: CalendarEventDto, date: string): Promise<boolean> => {
		if (!canManage) return false;
		if (event.kind === "HARVEST_PLANNED") {
			const cycle = cycleForPond(event.pondId);
			if (!cycle) return false;
			const span = daysBetween(cycle.stockingDate, date);
			if (span < 30 || span > 365) {
				toast.error(t("calendar.dateRangeError"));
				return false;
			}
			if (!window.confirm(t("calendar.rescheduleConfirm"))) return false;
			const result = await updateCropCycle(
				cycle.id,
				cycleToInput(cycle, {
					targetHarvestDate: date,
					growOutDays: span,
				}),
			);
			if (!result.success) {
				toast.error(result.error);
				return false;
			}
			toast.success(t("calendar.rescheduled"));
			router.refresh();
			refresh();
			return true;
		}
		if (event.kind === "MAINTENANCE" || event.kind === "OTHER") {
			const result = await updatePondEvent({
				id: event.id.replace(/^pond:/, ""),
				title: event.title,
				startsAt: date,
				notes: event.notes ?? null,
			});
			if (!result.success) {
				toast.error(result.error);
				return false;
			}
			toast.success(t("calendar.rescheduled"));
			router.refresh();
			refresh();
			return true;
		}
		return false;
	};

	const cancelCycle = () => {
		if (!selectedCycle) return;
		if (!window.confirm(t("summary.cancelConfirm"))) return;
		startCancel(async () => {
			const result = await cancelCropCycle({
				pondId: selectedCycle.pondId,
				cycleId: selectedCycle.id,
				notes: null,
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("summary.cancelled"));
			router.refresh();
			refresh();
		});
	};

	const upcoming = upcomingEvents
		.filter((event) => event.start.slice(0, 10) >= today)
		.sort((a, b) => a.start.localeCompare(b.start))
		.slice(0, 5);

	return (
		<div className="space-y-6">
			{/* Cycle summary */}
			{allPonds ? (
				<section className="rounded-[32px] border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
								{t("summary.allPondsTitle")}
							</p>
							<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("summary.allPondsDesc")}
							</h2>
						</div>
						{canManage && (
							<button
								type="button"
								onClick={openNewCycle}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
							>
								<Plus className="h-4 w-4" />
								{t("summary.startCycle")}
							</button>
						)}
					</div>
					{activeCycles.length === 0 ? (
						<p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{t("summary.noCycles")}</p>
					) : (
						<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{activeCycles.map((cycle) => {
								const pond = ponds.find((item) => item.id === cycle.pondId);
								const cycleMetrics = computeCropCycleMetrics(cycle, today);
								return (
									<button
										key={cycle.id}
										type="button"
										onClick={() => {
											setSelectedPondId(cycle.pondId);
											setAllPonds(false);
										}}
										className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 text-left transition-colors hover:border-[#0A3D62]/20 hover:bg-white dark:border-gray-700/60 dark:bg-gray-800/50 dark:hover:bg-gray-800"
									>
										<p className="text-xs font-black text-gray-900 dark:text-gray-100">
											{pond?.name ?? cycle.label ?? t("summary.cycle")}
										</p>
										<p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
											{t("summary.dayOf", {
												day: cycleMetrics.growOutDay,
												total: cycle.growOutDays,
											})}
										</p>
										<p
											className={`mt-1 text-[11px] font-bold ${
												cycleMetrics.daysToHarvest < 0
													? "text-red-600 dark:text-red-400"
													: "text-[#0A3D62] dark:text-[#9cc7f0]"
											}`}
										>
											{cycleMetrics.daysToHarvest < 0
												? t("summary.overdueBy", { days: Math.abs(cycleMetrics.daysToHarvest) })
												: t("summary.harvestIn", { days: cycleMetrics.daysToHarvest })}
										</p>
									</button>
								);
							})}
						</div>
					)}
				</section>
			) : selectedCycle && metrics ? (
				<section className="overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
					<div className="relative overflow-hidden bg-gradient-to-br from-[#0A3D62] via-[#0c4a73] to-[#08324f] px-5 py-5 text-white sm:px-6">
						<div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/5" />
						<div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200/80">
									{t("summary.eyebrow")}
								</p>
								<h2 className="mt-0.5 text-xl font-black">
									{selectedCycle.label || t("summary.cycle")}
								</h2>
								<p className="mt-0.5 text-xs font-medium text-blue-100/80">
									{selectedPond?.name ?? initialPondName}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<span
									className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
										metrics.daysToHarvest < 0
											? "bg-red-500/20 text-red-100 ring-1 ring-red-300/20"
											: "bg-white/10 text-white ring-1 ring-white/10"
									}`}
								>
									{metrics.daysToHarvest < 0
										? t("summary.overdue")
										: t(`summary.stage_${metrics.stage}`)}
								</span>
								{canManage && (
									<>
										<button
											type="button"
											onClick={() => openEditCycle(selectedCycle)}
											className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white ring-1 ring-white/10 transition-colors hover:bg-white/20"
										>
											{t("summary.editPlan")}
										</button>
										<button
											type="button"
											onClick={() => setHarvestOpen(true)}
											className="rounded-xl bg-[#FF6B35] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#e85a2a]"
										>
											{t("summary.markHarvested")}
										</button>
									</>
								)}
							</div>
						</div>
					</div>

					<div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
						<div>
							<div className="flex items-end justify-between gap-3">
								<div>
									<p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
										{t("summary.progress")}
									</p>
									<p className="mt-1 text-3xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
										{t("summary.dayOf", {
											day: metrics.growOutDay,
											total: selectedCycle.growOutDays,
										})}
									</p>
								</div>
								<p
									className={`text-right text-sm font-black ${
										metrics.daysToHarvest < 0
											? "text-red-600 dark:text-red-400"
											: "text-[#0A3D62] dark:text-[#9cc7f0]"
									}`}
								>
									{metrics.daysToHarvest < 0
										? t("summary.overdueBy", { days: Math.abs(metrics.daysToHarvest) })
										: t("summary.harvestIn", { days: metrics.daysToHarvest })}
								</p>
							</div>
							<div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
								<div
									className={`h-full rounded-full ${
										metrics.daysToHarvest < 0
											? "bg-red-500"
											: metrics.stage === "finish"
												? "bg-[#FF6B35]"
												: "bg-[#1E7B34]"
									}`}
									style={{ width: `${Math.max(2, metrics.progressPct)}%` }}
								/>
							</div>
							<div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
								<div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/50">
									<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.targetDate")}
									</p>
									<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
										{selectedCycle.targetHarvestDate}
									</p>
								</div>
								<div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/50">
									<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.targetWeight")}
									</p>
									<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
										{selectedCycle.targetHarvestWeightG
											? `${selectedCycle.targetHarvestWeightG} g`
											: "—"}
									</p>
								</div>
								<div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/50">
									<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.projected")}
									</p>
									<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
										{metrics.projectedHarvestBiomassKg !== null
											? `${metrics.projectedHarvestBiomassKg.toFixed(1)} kg`
											: "—"}
									</p>
								</div>
								<div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/50">
									<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.stocked")}
									</p>
									<p className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
										{selectedCycle.stockingCount}
									</p>
								</div>
							</div>
						</div>

						<div className="space-y-3">
							<div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
								<p className="flex items-center gap-2 text-xs font-black text-gray-800 dark:text-gray-100">
									<Sparkles className="h-4 w-4 text-[#FF6B35]" />
									{t("summary.aiHint")}
								</p>
								<p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
									{t("summary.aiHintDesc")}
								</p>
							</div>
							{selectedRecentCycles.length > 0 && (
								<div className="rounded-2xl border border-gray-100 p-4 dark:border-gray-700/60">
									<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.recent")}
									</p>
									<ul className="mt-2 space-y-1.5">
										{selectedRecentCycles.map((cycle) => (
											<li
												key={cycle.id}
												className="flex items-center justify-between gap-2 text-[11px]"
											>
												<span className="truncate font-semibold text-gray-700 dark:text-gray-200">
													{cycle.label || t("summary.cycle")}
												</span>
												<span className="shrink-0 text-gray-400">
													{cycle.actualHarvestDate ?? cycle.targetHarvestDate}
												</span>
											</li>
										))}
									</ul>
								</div>
							)}
							{canManage && (
								<button
									type="button"
									onClick={cancelCycle}
									disabled={isCancelling}
									className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
								>
									{isCancelling ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<PauseCircle className="h-3.5 w-3.5" />
									)}
									{t("summary.cancel")}
								</button>
							)}
						</div>
					</div>
				</section>
			) : (
				<section className="rounded-[32px] border border-dashed border-[#0A3D62]/20 bg-white p-6 text-center dark:border-white/10 dark:bg-gray-900">
					<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<Wheat className="h-7 w-7" />
					</div>
					<h2 className="mt-3 text-lg font-black text-gray-900 dark:text-gray-100">
						{isFallow ? t("summary.fallowTitle") : t("summary.noCycleTitle")}
					</h2>
					<p className="mx-auto mt-1 max-w-lg text-sm text-gray-500 dark:text-gray-400">
						{isFallow ? t("summary.fallowDesc") : t("summary.noCycleDesc")}
					</p>
					{canManage && (
						<button
							type="button"
							onClick={openNewCycle}
							className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
						>
							<Plus className="h-4 w-4" />
							{t("summary.startCycle")}
						</button>
					)}
				</section>
			)}

			{/* Calendar + filters */}
			<section className="min-w-0 overflow-x-clip rounded-[32px] border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 sm:p-5">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div className="min-w-0">
						<h2 className="flex items-center gap-2 text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							<CalendarDays className="h-5 w-5 shrink-0" />
							{t("calendar.title")}
						</h2>
						<p className="text-xs text-gray-500 dark:text-gray-400">{t("calendar.desc")}</p>
					</div>
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<label className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
							<Fish className="h-3.5 w-3.5 shrink-0" />
							<select
								value={allPonds ? "all" : selectedPondId}
								aria-label={t("calendar.allPonds")}
								onChange={(event) => {
									if (event.target.value === "all") {
										setAllPonds(true);
									} else {
										setSelectedPondId(event.target.value);
										setAllPonds(false);
									}
								}}
								className="max-w-[11rem] min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
							>
								{ponds.map((pond) => (
									<option key={pond.id} value={pond.id}>
										{pond.name}
									</option>
								))}
								<option value="all">{t("calendar.allPonds")}</option>
							</select>
						</label>
						<button
							type="button"
							onClick={refresh}
							disabled={loading}
							className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
							{t("calendar.refresh")}
						</button>
						{canManage && !allPonds && (
							<button
								type="button"
								onClick={() => {
									setEditingEvent(null);
									setEventDate(today);
									setEventFormOpen(true);
								}}
								className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A3D62] px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
							>
								<Plus className="h-3.5 w-3.5" />
								{t("calendar.addEvent")}
							</button>
						)}
					</div>
				</div>

				<fieldset
					aria-label={t("calendar.filters")}
					className="m-0 mt-4 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
				>
					<span className="mr-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-400">
						<Filter className="h-3 w-3" />
						{t("calendar.filters")}
					</span>
					{CALENDAR_EVENT_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							onClick={() => toggleType(type)}
							aria-pressed={types.has(type)}
							className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${
								types.has(type)
									? "bg-[#0A3D62] text-white dark:bg-[#1f66a0]"
									: "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
							}`}
						>
							{t(`filters.${type}`)}
						</button>
					))}
				</fieldset>

				{error && (
					<div className="mt-4 flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center">
						<CloudOff className="h-4 w-4 shrink-0" />
						<p className="min-w-0 flex-1">{error}</p>
						<button
							type="button"
							onClick={refresh}
							className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
						>
							<RefreshCw className="h-3.5 w-3.5" />
							{t("calendar.refresh")}
						</button>
					</div>
				)}
				{truncated && (
					<div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
						<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
						{t("calendar.truncated")}
					</div>
				)}

				{!loading && !error && events.length === 0 && viewType !== "listMonth" && (
					<output className="mt-4 block rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-3 text-center text-xs font-semibold text-gray-500 dark:border-gray-700/60 dark:bg-gray-800/40 dark:text-gray-400">
						{t("calendar.noEvents")}
					</output>
				)}

				<div className="relative mt-4 min-w-0" aria-busy={loading}>
					{loading && (
						<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-[#0A3D62]/10 dark:bg-white/10">
							<div className="h-full w-1/3 animate-pulse rounded-full bg-[#0A3D62] dark:bg-[#5b9bd5]" />
						</div>
					)}
					<CalendarErrorBoundary
						title={t("calendar.title")}
						message={t("calendar.loadError")}
						retryLabel={t("calendar.refresh")}
						resetKey={`${range.from}:${range.to}:${typesKey}:${allPonds}:${selectedPondId}`}
					>
						<CalendarView
							events={events}
							canManage={canManage}
							allPonds={allPonds}
							onRangeChange={(from, to) => {
								setRange((current) =>
									current.from === from && current.to === to ? current : { from, to },
								);
							}}
							onViewChange={setViewType}
							onEventClick={handleEventClick}
							onDateClick={handleDateClick}
							onEventDrop={handleEventDrop}
						/>
					</CalendarErrorBoundary>
				</div>
			</section>

			{/* Upcoming */}
			<section className="rounded-[32px] border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
						{t("upcoming.title")}
					</h2>
					<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
						{t("upcoming.next", { count: upcoming.length })}
					</span>
				</div>
				{upcoming.length === 0 ? (
					<p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("upcoming.empty")}</p>
				) : (
					<ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
						{upcoming.map((event) => (
							<li key={event.id}>
								<button
									type="button"
									onClick={() => handleEventClick(event)}
									className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
								>
									<span
										className={`h-2.5 w-2.5 shrink-0 rounded-full ${
											event.type === "harvest"
												? "bg-[#FF6B35]"
												: event.type === "sampling"
													? "bg-teal-600"
													: event.type === "device"
														? "bg-red-500"
														: "bg-violet-600"
										}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">
											{labelFor(event)}
										</span>
										<span className="block truncate text-[11px] text-gray-400">
											{formatEventMoment(event, locale)}
											{allPonds ? ` · ${event.pondName}` : ""}
										</span>
									</span>
									<ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			<CycleForm
				open={cycleFormOpen}
				onClose={() => setCycleFormOpen(false)}
				onSaved={refresh}
				ponds={ponds}
				initialPondId={selectedPondId}
				cycle={editingCycle}
			/>
			<HarvestForm
				open={harvestOpen}
				onClose={() => setHarvestOpen(false)}
				onSaved={refresh}
				cycle={selectedCycle}
			/>
			<EventForm
				open={eventFormOpen}
				onClose={() => setEventFormOpen(false)}
				onSaved={refresh}
				pondId={selectedPondId}
				date={eventDate}
				event={editingEvent}
			/>

			<Modal
				open={Boolean(details)}
				onClose={() => setDetails(null)}
				title={details ? labelFor(details) : ""}
				description={
					details ? `${details.pondName} · ${formatEventMoment(details, locale)}` : undefined
				}
				footer={
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
						{canCompleteDetails && (
							<button
								type="button"
								onClick={markEventDone}
								disabled={isCompleting}
								className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1E7B34] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#18652b] disabled:opacity-50"
							>
								{isCompleting ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Check className="h-4 w-4" />
								)}
								{t("details.markDone")}
							</button>
						)}
						{canEditDetails && (
							<button
								type="button"
								onClick={openEventEditor}
								className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
							>
								{t("eventForm.titleEdit")}
							</button>
						)}
						{canRescheduleDetails && (
							<button
								type="button"
								onClick={openCycleEditorFromDetails}
								className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
							>
								{t("summary.editPlan")}
							</button>
						)}
						<button
							type="button"
							onClick={() => setDetails(null)}
							className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							{t("details.close")}
						</button>
					</div>
				}
			>
				{details && (
					<div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
						<div className="grid gap-2 sm:grid-cols-2">
							<p className="flex min-w-0 items-center gap-2">
								<Scale className="h-4 w-4 shrink-0 text-gray-400" />
								<span className="text-gray-400">{t("details.pond")}</span>
								<strong className="truncate text-gray-800 dark:text-gray-100">
									{details.pondName}
								</strong>
							</p>
							<p className="flex min-w-0 items-center gap-2">
								<CalendarDays className="h-4 w-4 shrink-0 text-gray-400" />
								<span className="text-gray-400">{t("details.date")}</span>
								<strong className="truncate text-gray-800 dark:text-gray-100">
									{formatEventMoment(details, locale)}
								</strong>
							</p>
						</div>
						{details.notes && (
							<div>
								<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
									{t("eventForm.notes")}
								</p>
								<p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-500 dark:text-gray-400">
									{details.notes}
								</p>
							</div>
						)}
						{details.type === "sampling" && (
							<p className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
								{t("details.samplingHint")}
							</p>
						)}
						{details.href && (details.type === "sampling" || details.type === "harvest") && (
							<Link
								href={details.href}
								onClick={() => setDetails(null)}
								className="inline-flex items-center gap-1.5 rounded-xl bg-[#0A3D62]/5 px-3 py-2 text-xs font-bold text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/10 dark:bg-white/5 dark:text-[#9cc7f0] dark:hover:bg-white/10"
							>
								<ExternalLink className="h-3.5 w-3.5" />
								{details.type === "sampling" ? tNav("logSample") : tNav("harvest")}
							</Link>
						)}
					</div>
				)}
			</Modal>
		</div>
	);
}
