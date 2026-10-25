"use client";

import { Link, useRouter } from "@/i18n/routing";
import { cancelCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { completePondEvent, updatePondEvent } from "@/lib/actions/pond-event";
import { ApiClientError, apiGet } from "@/lib/api-client";
import { HOPPER_CAPACITY_KG } from "@/lib/constants";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { CALENDAR_EVENT_TYPES, isCalendarEventType } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays, daysBetween, todayDateOnly } from "@/lib/crop-cycle/dates";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import {
	CalendarDays,
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	CloudOff,
	Cpu,
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
	initialAllPonds?: boolean;
	/** `org` asks the events API for every pond in the admin's organization. */
	apiScope?: "org";
	ponds: PondOption[];
	activeCycle: CropCycleDto | null;
	activeCycles: CropCycleDto[];
	recentCycles: CropCycleDto[];
	canManage: boolean;
	today: string;
	hopperLevelPct: number;
	hopperIsOffline: boolean;
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
	initialAllPonds = false,
	apiScope,
	ponds,
	activeCycle,
	activeCycles,
	recentCycles,
	canManage,
	today,
	hopperLevelPct,
	hopperIsOffline,
}: HarvestCalendarProps) {
	const t = useTranslations("dashboard.harvest");
	const tNav = useTranslations("nav");
	const locale = useLocale();
	const router = useRouter();
	const requestId = useRef(0);
	const [selectedPondId, setSelectedPondId] = useState(initialPondId);
	const [allPonds, setAllPonds] = useState(initialAllPonds);
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
	const [cycleDetailsOpen, setCycleDetailsOpen] = useState(false);
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
	const hopperDisplayPct = hopperIsOffline ? 0 : hopperLevelPct;
	const hopperRemainingKg = (HOPPER_CAPACITY_KG * (hopperDisplayPct / 100)).toFixed(1);
	const hopperScheduledFeedings = Math.floor(Number.parseFloat(hopperRemainingKg) / 0.35);

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
		if (apiScope) params.set("scope", apiScope);

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
	}, [allPonds, selectedPondId, typesKey, refreshKey, today, apiScope]);

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
		if (apiScope) params.set("scope", apiScope);

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
	}, [allPonds, range.from, range.to, selectedPondId, t, typesKey, refreshKey, apiScope]);

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
		<div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-4 animate-in fade-in duration-150 [contain:inline-size] xl:h-[calc(100dvh-8rem)] xl:overflow-hidden">
			<div className="flex flex-none flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
				<div className="flex items-center gap-2">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<CalendarDays className="h-6 w-6" />
					</div>
					<div className="min-w-0">
						<h1 className="text-2xl font-black tracking-tight text-[var(--ofd-base-deep)] sm:text-3xl">
							{t("title")}
						</h1>
						<p className="text-sm text-gray-500 dark:text-gray-400">
							{t("desc", { pond: selectedPond?.name ?? initialPondName })}
						</p>
					</div>
				</div>

				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
					{allPonds ? (
						<>
							<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gray-100 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
								<span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
									{t("summary.allPondsTitle")}
								</span>
								<span className="truncate text-sm font-black text-[#0A3D62] dark:text-[#5b9bd5]">
									{t("summary.allPondsDesc")}
								</span>
								<span className="rounded-full bg-[#0A3D62]/5 px-2 py-0.5 text-[10px] font-black text-[#0A3D62] dark:bg-white/5 dark:text-[#9cc7f0]">
									{activeCycles.length}
								</span>
							</div>
							{canManage && (
								<button
									type="button"
									onClick={openNewCycle}
									className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
								>
									<Plus className="h-4 w-4" />
									{t("summary.startCycle")}
								</button>
							)}
						</>
					) : selectedCycle && metrics ? (
						<>
							<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-gray-100 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
								<span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
									{t("summary.eyebrow")}
								</span>
								<span className="truncate text-sm font-black text-[#0A3D62] dark:text-[#5b9bd5]">
									{selectedCycle.label || t("summary.cycle")}
								</span>
								<span className="truncate text-xs text-gray-500 dark:text-gray-400">
									{selectedPond?.name ?? initialPondName}
								</span>
								<span
									className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
										metrics.daysToHarvest < 0
											? "bg-red-500/10 text-red-600 dark:text-red-400"
											: "bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#9cc7f0]"
									}`}
								>
									{metrics.daysToHarvest < 0
										? t("summary.overdue")
										: t(`summary.stage_${metrics.stage}`)}
								</span>
								<span className="text-xs font-bold text-gray-700 dark:text-gray-200">
									{t("summary.dayOf", {
										day: metrics.growOutDay,
										total: selectedCycle.growOutDays,
									})}
								</span>
								<span
									className={`text-xs font-black ${
										metrics.daysToHarvest < 0
											? "text-red-600 dark:text-red-400"
											: "text-[#0A3D62] dark:text-[#9cc7f0]"
									}`}
								>
									{metrics.daysToHarvest < 0
										? t("summary.overdueBy", { days: Math.abs(metrics.daysToHarvest) })
										: t("summary.harvestIn", { days: metrics.daysToHarvest })}
								</span>
								<button
									type="button"
									onClick={() => setCycleDetailsOpen((value) => !value)}
									aria-expanded={cycleDetailsOpen}
									className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
								>
									{t("summary.progress")}
									<ChevronDown
										className={`h-3.5 w-3.5 transition-transform ${
											cycleDetailsOpen ? "rotate-180" : ""
										}`}
									/>
								</button>
							</div>
							{canManage && (
								<div className="flex shrink-0 items-center gap-2">
									<button
										type="button"
										onClick={() => openEditCycle(selectedCycle)}
										className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
								</div>
							)}
						</>
					) : (
						<>
							<div className="flex min-w-0 items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed border-[#0A3D62]/20 bg-white px-4 py-2.5 shadow-sm dark:border-white/10 dark:bg-gray-900">
								<Wheat className="h-4 w-4 shrink-0 text-[#0A3D62] dark:text-[#5b9bd5]" />
								<span className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
									{isFallow ? t("summary.fallowTitle") : t("summary.noCycleTitle")}
								</span>
								<span className="hidden min-w-0 truncate text-xs text-gray-500 dark:text-gray-400 sm:block">
									{isFallow ? t("summary.fallowDesc") : t("summary.noCycleDesc")}
								</span>
							</div>
							{canManage && (
								<button
									type="button"
									onClick={openNewCycle}
									className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#164e7c] dark:bg-[#1f66a0]"
								>
									<Plus className="h-4 w-4" />
									{t("summary.startCycle")}
								</button>
							)}
						</>
					)}
				</div>
			</div>

			{!allPonds && selectedCycle && metrics && cycleDetailsOpen && (
				<div className="flex-none rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 xl:max-h-[38vh] xl:overflow-y-auto">
					<div className="flex items-end justify-between gap-3">
						<div>
							<p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
								{t("summary.progress")}
							</p>
							<p className="mt-0.5 text-2xl font-black text-[#0A3D62] dark:text-[#5b9bd5]">
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
					<div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
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
					<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
						<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5 dark:border-gray-700/60 dark:bg-gray-800/50">
							<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
								{t("summary.targetDate")}
							</p>
							<p className="mt-0.5 text-xs font-black text-gray-900 dark:text-gray-100">
								{selectedCycle.targetHarvestDate}
							</p>
						</div>
						<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5 dark:border-gray-700/60 dark:bg-gray-800/50">
							<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
								{t("summary.targetWeight")}
							</p>
							<p className="mt-0.5 text-xs font-black text-gray-900 dark:text-gray-100">
								{selectedCycle.targetHarvestWeightG
									? `${selectedCycle.targetHarvestWeightG} g`
									: "—"}
							</p>
						</div>
						<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5 dark:border-gray-700/60 dark:bg-gray-800/50">
							<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
								{t("summary.projected")}
							</p>
							<p className="mt-0.5 text-xs font-black text-gray-900 dark:text-gray-100">
								{metrics.projectedHarvestBiomassKg !== null
									? `${metrics.projectedHarvestBiomassKg.toFixed(1)} kg`
									: "—"}
							</p>
						</div>
						<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5 dark:border-gray-700/60 dark:bg-gray-800/50">
							<p className="text-[9px] font-black uppercase tracking-wider text-gray-400">
								{t("summary.stocked")}
							</p>
							<p className="mt-0.5 text-xs font-black text-gray-900 dark:text-gray-100">
								{selectedCycle.stockingCount}
							</p>
						</div>
					</div>
					<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<p className="flex min-w-0 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
							<Sparkles className="h-3.5 w-3.5 shrink-0 text-[#FF6B35]" />
							<span className="truncate">{t("summary.aiHintDesc")}</span>
						</p>
						{canManage && (
							<button
								type="button"
								onClick={cancelCycle}
								disabled={isCancelling}
								className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
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
					{selectedRecentCycles.length > 0 && (
						<div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-800">
							<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
								{t("summary.recent")}
							</p>
							<ul className="mt-1.5 grid gap-1 sm:grid-cols-3">
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
				</div>
			)}

			<div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
				<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
					<div className="flex flex-none flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<fieldset
								aria-label={t("calendar.filters")}
								className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
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
							<div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
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
						{error && (
							<div className="flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center">
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
							<div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
								<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
								{t("calendar.truncated")}
							</div>
						)}
						{!loading && !error && events.length === 0 && viewType !== "listMonth" && (
							<output className="block rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-2.5 text-center text-xs font-semibold text-gray-500 dark:border-gray-700/60 dark:bg-gray-800/40 dark:text-gray-400">
								{t("calendar.noEvents")}
							</output>
						)}
					</div>
					<div className="relative min-h-0 flex-1 px-3 pb-3 pt-2 sm:px-4" aria-busy={loading}>
						{loading && (
							<div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-[#0A3D62]/10 dark:bg-white/10">
								<div className="h-full w-1/3 animate-pulse rounded-full bg-[#0A3D62] dark:text-[#5b9bd5]" />
							</div>
						)}
						<div className="h-[62vh] min-h-[420px] xl:h-full xl:min-h-0">
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
					</div>
				</section>

				<aside className="flex w-full flex-col gap-4 xl:w-[300px] xl:min-h-0 xl:flex-none">
					<section className="flex min-h-0 flex-col rounded-[28px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 xl:flex-1 xl:overflow-hidden">
						<div className="flex flex-none items-center justify-between gap-3">
							<h2 className="text-base font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("upcoming.title")}
							</h2>
							<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
								{t("upcoming.next", { count: upcoming.length })}
							</span>
						</div>
						{upcoming.length === 0 ? (
							<p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t("upcoming.empty")}</p>
						) : (
							<ul className="mt-2 min-h-0 divide-y divide-gray-100 dark:divide-gray-800 xl:flex-1 xl:overflow-y-auto">
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

					<section className="flex-none rounded-[28px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
						<div className="flex items-center justify-between gap-2">
							<p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
								<Cpu className="h-3.5 w-3.5 text-[#E85A2A]" />
								{tNav("hopperLevel")}
							</p>
							{hopperIsOffline && (
								<span className="rounded-full bg-[#C42B3A]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#C42B3A]">
									{tNav("deviceOffline")}
								</span>
							)}
						</div>
						<div className="mt-2 flex items-center justify-between text-xs font-extrabold text-[#0A3D62] dark:text-[#5b9bd5]">
							<span>{tNav("pondFeedPellet")}</span>
							<span>{hopperDisplayPct}%</span>
						</div>
						<div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#3D5568]/20 dark:bg-gray-700">
							<div
								className={`h-full rounded-full transition-all duration-1000 ${
									hopperDisplayPct < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]"
								}`}
								style={{ width: `${hopperDisplayPct}%` }}
							/>
						</div>
						<div className="mt-2 text-[10px] leading-tight font-mono text-[#3D5568] dark:text-gray-400">
							{hopperIsOffline
								? tNav("hopperOffline")
								: tNav("hopperRemaining", {
										kg: hopperRemainingKg,
										count: hopperScheduledFeedings,
									})}
						</div>
					</section>
				</aside>
			</div>

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
