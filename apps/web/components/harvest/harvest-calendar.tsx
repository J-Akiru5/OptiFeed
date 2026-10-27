"use client";

import { FeedLevelDisplay } from "@/components/feed-level-display";
import { Link, useRouter } from "@/i18n/routing";
import { cancelCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import {
	completePondEvent,
	deletePondEvent,
	uncompletePondEvent,
	updatePondEvent,
} from "@/lib/actions/pond-event";
import { ApiClientError, apiGet } from "@/lib/api-client";
import {
	farmDateTimeToUtcDate,
	fullCalendarValueToFarmValue,
	utcDateToFarmDateOnly,
	utcDateToFarmDateTime,
} from "@/lib/calendar/datetime";
import { HOPPER_CAPACITY_KG } from "@/lib/constants";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { CALENDAR_EVENT_TYPES, isCalendarEventType } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays, daysBetween, todayDateOnly } from "@/lib/crop-cycle/dates";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { resolveFeedLevelDisplay } from "@/lib/feed-level-display";
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
import { EventEditor, type EventEditorSelection } from "./event-editor";
import { HarvestForm } from "./harvest-form";
import { Modal } from "./modal";

const CalendarView = dynamic(
	() => import("./calendar-view").then((module) => module.CalendarView),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-80 items-center justify-center rounded-3xl border border-gray-100 bg-gray-50/60 dark:border-gray-700/60 dark:bg-gray-800/40">
				<Loader2
					aria-hidden="true"
					className="h-6 w-6 animate-spin text-[#0A3D62] dark:text-[#5b9bd5]"
				/>
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
	hopperLevelPct?: number | null;
	hopperFeedLevelUpdatedAt?: string | null;
	hopperIsOffline?: boolean;
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
	hopperFeedLevelUpdatedAt,
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
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorSelection, setEditorSelection] = useState<EventEditorSelection | null>(null);
	const [editingEvent, setEditingEvent] = useState<CalendarEventDto | null>(null);
	const [details, setDetails] = useState<CalendarEventDto | null>(null);
	const [cycleDetailsOpen, setCycleDetailsOpen] = useState(false);
	const [isCancelling, startCancel] = useTransition();
	const [isCompleting, startComplete] = useTransition();
	const [isDeleting, startDelete] = useTransition();
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
	const hopperUpdatedAt = hopperFeedLevelUpdatedAt ? new Date(hopperFeedLevelUpdatedAt) : null;
	const hopperLevel = resolveFeedLevelDisplay({
		levelPercent: hopperLevelPct ?? null,
		updatedAt: hopperUpdatedAt,
		isOffline: hopperIsOffline ?? false,
	});
	const hopperRemainingKg =
		hopperLevel.state === "live"
			? (HOPPER_CAPACITY_KG * (hopperLevel.percent / 100)).toFixed(1)
			: null;
	const hopperScheduledFeedings =
		hopperRemainingKg !== null ? Math.floor(Number.parseFloat(hopperRemainingKg) / 0.35) : 0;

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
	const canEditDetails = Boolean(details?.editable && canManage && details.source === "manual");
	const canRescheduleDetails = Boolean(
		details &&
			details.kind === "HARVEST_PLANNED" &&
			details.source !== "manual" &&
			canManage &&
			detailCycle,
	);
	const selectedRecentCycles = recentCycles
		.filter((cycle) => cycle.pondId === selectedPondId)
		.slice(0, 3);
	const canCompleteDetails = Boolean(
		canEditDetails &&
			!details?.completed &&
			details?.status !== "done" &&
			// A repeating Event is managed with "this / all"; only Tasks (and
			// one-off Events) get a done action.
			(details?.itemKind === "TASK" || !details?.recurrenceFreq),
	);
	const canDeleteOccurrence = Boolean(canEditDetails && details?.recurrenceFreq);
	const canDeleteSeries = Boolean(canEditDetails);

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
		setEditorOpen(true);
	};

	const openNewEvent = (selection: EventEditorSelection) => {
		if (!canManage || allPonds) return;
		setEditingEvent(null);
		setEditorSelection(selection);
		setEditorOpen(true);
	};

	const openCycleEditorFromDetails = () => {
		if (!detailCycle || !canRescheduleDetails) return;
		setDetails(null);
		openEditCycle(detailCycle);
	};

	const taskOccurrence = (event: CalendarEventDto): string | null =>
		event.recurrenceFreq ? (event.occurrenceKey ?? null) : null;

	const markEventDone = () => {
		if (!details || !canCompleteDetails || isCompleting) return;
		const id = details.pondEventId ?? details.id.replace(/^pond:/, "").split(":")[0];
		const occurrence = taskOccurrence(details);
		startComplete(async () => {
			const result = await completePondEvent({ id, occurrence });
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

	const toggleTask = (event: CalendarEventDto) => {
		if (!canManage) return;
		const id = event.pondEventId ?? event.id.replace(/^pond:/, "").split(":")[0];
		const occurrence = taskOccurrence(event);
		const nextCompleted = !event.completed;

		// Optimistic checkbox, then roll back when the server rejects.
		setEvents((current) =>
			current.map((item) => (item.id === event.id ? { ...item, completed: nextCompleted } : item)),
		);
		setUpcomingEvents((current) =>
			current.map((item) => (item.id === event.id ? { ...item, completed: nextCompleted } : item)),
		);

		void (async () => {
			const result = nextCompleted
				? await completePondEvent({ id, occurrence })
				: await uncompletePondEvent({ id, occurrence });
			if (!result.success) {
				setEvents((current) =>
					current.map((item) =>
						item.id === event.id ? { ...item, completed: !nextCompleted } : item,
					),
				);
				setUpcomingEvents((current) =>
					current.map((item) =>
						item.id === event.id ? { ...item, completed: !nextCompleted } : item,
					),
				);
				toast.error(result.error);
				return;
			}
			toast.success(nextCompleted ? t("task.completed") : t("task.reopened"));
			router.refresh();
			refresh();
		})();
	};

	const handleDateClick = (date: string) => {
		openNewEvent({ start: date, end: null, allDay: true });
	};

	const handleSelect = (selection: EventEditorSelection) => {
		openNewEvent(selection);
	};

	/**
	 * Persist a drag/resize. FullCalendar has already moved the block; returning
	 * false reverts it (the rollback the brief asks for).
	 */
	const persistRange = async (
		event: CalendarEventDto,
		start: string,
		end: string | null,
	): Promise<boolean> => {
		if (!canManage) return false;

		// FullCalendar may emit an offset or seconds; the calendar stores naive
		// farm-local values. All-day ends are exclusive in the grid and
		// inclusive in storage.
		const startValue = fullCalendarValueToFarmValue(start, event.allDay);
		const rawEnd = end ? fullCalendarValueToFarmValue(end, event.allDay) : null;
		const endValue = rawEnd ? (event.allDay ? addDays(rawEnd, -1) : rawEnd) : null;
		const normalizedEnd = endValue && endValue !== startValue ? endValue : null;

		if (event.source !== "manual") {
			if (event.kind !== "HARVEST_PLANNED") return false;
			const cycle = cycleForPond(event.pondId);
			if (!cycle) return false;
			const date = startValue.slice(0, 10);
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

		const id = event.pondEventId ?? event.id.replace(/^pond:/, "").split(":")[0];

		if (event.recurrenceFreq) {
			if (!window.confirm(t("calendar.recurringChangeConfirm"))) return false;
			const occurrenceStart = farmDateTimeToUtcDate(event.start);
			const occurrenceEnd = event.end ? farmDateTimeToUtcDate(event.end) : null;
			const nextStart = farmDateTimeToUtcDate(startValue);
			const startDelta = nextStart.getTime() - occurrenceStart.getTime();
			const endDelta =
				normalizedEnd && occurrenceEnd
					? farmDateTimeToUtcDate(normalizedEnd).getTime() - occurrenceEnd.getTime()
					: startDelta;

			const seriesStart = farmDateTimeToUtcDate(event.seriesStartsAt ?? event.start);
			const shiftedStart = new Date(seriesStart.getTime() + startDelta);
			const seriesEnd = event.seriesEndsAt
				? new Date(farmDateTimeToUtcDate(event.seriesEndsAt).getTime() + endDelta)
				: null;
			if (seriesEnd && seriesEnd.getTime() <= shiftedStart.getTime()) return false;

			const result = await updatePondEvent({
				id,
				allDay: event.allDay,
				startsAt: event.allDay
					? utcDateToFarmDateOnly(shiftedStart)
					: utcDateToFarmDateTime(shiftedStart),
				endsAt: seriesEnd
					? event.allDay
						? utcDateToFarmDateOnly(seriesEnd)
						: utcDateToFarmDateTime(seriesEnd)
					: null,
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

		const result = await updatePondEvent({
			id,
			allDay: event.allDay,
			startsAt: startValue,
			endsAt: normalizedEnd,
		});
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		toast.success(t("calendar.rescheduled"));
		router.refresh();
		refresh();
		return true;
	};

	const handleEventDrop = (event: CalendarEventDto, start: string, end: string | null) =>
		persistRange(event, start, end);

	const handleEventResize = (event: CalendarEventDto, start: string, end: string | null) =>
		persistRange(event, start, end);

	const deleteOccurrence = () => {
		if (!details || !canDeleteOccurrence || isDeleting) return;
		if (!window.confirm(t("details.deleteOccurrenceConfirm"))) return;
		const id = details.pondEventId ?? details.id.replace(/^pond:/, "").split(":")[0];
		const occurrence = details.occurrenceKey ?? null;
		startDelete(async () => {
			const result = await deletePondEvent({ id, occurrence });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("eventForm.successDelete"));
			setDetails(null);
			router.refresh();
			refresh();
		});
	};

	const deleteSeries = () => {
		if (!details || !canDeleteSeries || isDeleting) return;
		if (!window.confirm(t("eventForm.deleteConfirm"))) return;
		const id = details.pondEventId ?? details.id.replace(/^pond:/, "").split(":")[0];
		startDelete(async () => {
			const result = await deletePondEvent({ id });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(t("eventForm.successDelete"));
			setDetails(null);
			router.refresh();
			refresh();
		});
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
						<CalendarDays aria-hidden="true" className="h-6 w-6" />
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
									<Plus aria-hidden="true" className="h-4 w-4" />
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
									className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-400 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
								>
									{t("summary.progress")}
									<ChevronDown
										aria-hidden="true"
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
										className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
									>
										{t("summary.editPlan")}
									</button>
									<button
										type="button"
										onClick={() => setHarvestOpen(true)}
										className="inline-flex min-h-11 items-center rounded-xl bg-[#C2410C] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
									>
										{t("summary.markHarvested")}
									</button>
								</div>
							)}
						</>
					) : (
						<>
							<div className="flex min-w-0 items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed border-[#0A3D62]/20 bg-white px-4 py-2.5 shadow-sm dark:border-white/10 dark:bg-gray-900">
								<Wheat
									aria-hidden="true"
									className="h-4 w-4 shrink-0 text-[#0A3D62] dark:text-[#5b9bd5]"
								/>
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
									<Plus aria-hidden="true" className="h-4 w-4" />
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
							<Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#FF6B35]" />
							<span className="truncate">{t("summary.aiHintDesc")}</span>
						</p>
						{canManage && (
							<button
								type="button"
								onClick={cancelCycle}
								disabled={isCancelling}
								className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30 dark:focus-visible:outline-[#8fc0ea]"
							>
								{isCancelling ? (
									<Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
								) : (
									<PauseCircle aria-hidden="true" className="h-3.5 w-3.5" />
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
				<section
					aria-label={t("calendar.eventsLabel")}
					className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-gray-100 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900"
				>
					<div className="flex flex-none flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<fieldset
								aria-label={t("calendar.filters")}
								className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
							>
								<span className="mr-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-400">
									<Filter aria-hidden="true" className="h-3 w-3" />
									{t("calendar.filters")}
								</span>
								{CALENDAR_EVENT_TYPES.map((type) => (
									<button
										key={type}
										type="button"
										onClick={() => toggleType(type)}
										aria-pressed={types.has(type)}
										className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
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
									<Fish aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
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
									className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
								>
									<RefreshCw
										aria-hidden="true"
										className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
									/>
									{t("calendar.refresh")}
								</button>
								{canManage && !allPonds && (
									<button
										type="button"
										onClick={() => openNewEvent({ start: today, end: null, allDay: true })}
										className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[#0A3D62] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#164e7c] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:bg-[#1f66a0] dark:focus-visible:outline-[#8fc0ea]"
									>
										<Plus aria-hidden="true" className="h-3.5 w-3.5" />
										{t("calendar.addEvent")}
									</button>
								)}
							</div>
						</div>
						{error && (
							<div className="flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center">
								<CloudOff aria-hidden="true" className="h-4 w-4 shrink-0" />
								<p className="min-w-0 flex-1">{error}</p>
								<button
									type="button"
									onClick={refresh}
									className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30 dark:focus-visible:outline-[#8fc0ea]"
								>
									<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
									{t("calendar.refresh")}
								</button>
							</div>
						)}
						{truncated && (
							<div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
								<CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
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
									onSelect={handleSelect}
									onEventDrop={handleEventDrop}
									onEventResize={handleEventResize}
									onToggleTask={toggleTask}
								/>
							</CalendarErrorBoundary>
						</div>
					</div>
				</section>

				<aside className="flex w-full flex-col gap-4 xl:w-[300px] xl:min-h-0 xl:flex-none">
					<section
						aria-label={t("upcoming.listLabel")}
						className="flex min-h-0 flex-col rounded-[28px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 xl:flex-1 xl:overflow-hidden"
					>
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
							<ul
								aria-label={t("upcoming.listLabel")}
								className="mt-2 min-h-0 divide-y divide-gray-100 dark:divide-gray-800 xl:flex-1 xl:overflow-y-auto"
							>
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
											<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-300" />
										</button>
									</li>
								))}
							</ul>
						)}
					</section>

					{hopperLevelPct !== undefined && (
						<section className="flex-none rounded-[28px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900">
							<div className="flex items-center justify-between gap-2">
								<p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
									<Cpu aria-hidden="true" className="h-3.5 w-3.5 text-[#E85A2A]" />
									{tNav("hopperLevel")}
								</p>
							</div>
							<div className="mt-2 flex items-center justify-between text-xs font-extrabold text-[#0A3D62] dark:text-[#5b9bd5]">
								<span>{tNav("pondFeedPellet")}</span>
							</div>
							<div className="mt-1.5">
								<FeedLevelDisplay
									levelPercent={hopperLevelPct ?? null}
									updatedAt={hopperUpdatedAt}
									isOffline={hopperIsOffline ?? false}
									size="sm"
								/>
							</div>
							{hopperRemainingKg !== null && (
								<div className="mt-2 text-[10px] leading-tight font-mono text-[#3D5568] dark:text-gray-400">
									{tNav("hopperRemaining", {
										kg: hopperRemainingKg,
										count: hopperScheduledFeedings,
									})}
								</div>
							)}
						</section>
					)}
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
			<EventEditor
				open={editorOpen}
				onClose={() => setEditorOpen(false)}
				onSaved={refresh}
				pondId={selectedPondId}
				ponds={ponds}
				selection={editorSelection}
				event={editingEvent}
			/>

			<Modal
				open={Boolean(details)}
				side="right"
				size="md"
				onClose={() => setDetails(null)}
				title={details ? labelFor(details) : ""}
				description={
					details ? `${details.pondName} · ${formatEventMoment(details, locale)}` : undefined
				}
				footer={
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
						{canDeleteOccurrence && (
							<button
								type="button"
								onClick={deleteOccurrence}
								disabled={isDeleting}
								className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30 dark:focus-visible:outline-[#8fc0ea]"
							>
								{t("details.deleteOccurrence")}
							</button>
						)}
						{canDeleteSeries && (
							<button
								type="button"
								onClick={deleteSeries}
								disabled={isDeleting}
								className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30 dark:focus-visible:outline-[#8fc0ea]"
							>
								{details?.recurrenceFreq ? t("details.deleteSeries") : t("details.delete")}
							</button>
						)}
						{canCompleteDetails && (
							<button
								type="button"
								onClick={markEventDone}
								disabled={isCompleting}
								className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#1E7B34] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#18652b] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:focus-visible:outline-[#8fc0ea]"
							>
								{isCompleting ? (
									<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
								) : (
									<Check aria-hidden="true" className="h-4 w-4" />
								)}
								{t("details.markDone")}
							</button>
						)}
						{canEditDetails && (
							<button
								type="button"
								onClick={openEventEditor}
								className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
							>
								{t("eventForm.titleEdit")}
							</button>
						)}
						{canRescheduleDetails && (
							<button
								type="button"
								onClick={openCycleEditorFromDetails}
								className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
							>
								{t("summary.editPlan")}
							</button>
						)}
						<button
							type="button"
							onClick={() => setDetails(null)}
							className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
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
								<Scale aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />
								<span className="text-gray-400">{t("details.pond")}</span>
								<strong className="truncate text-gray-800 dark:text-gray-100">
									{details.pondName}
								</strong>
							</p>
							<p className="flex min-w-0 items-center gap-2">
								<CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />
								<span className="text-gray-400">{t("details.date")}</span>
								<strong className="truncate text-gray-800 dark:text-gray-100">
									{formatEventMoment(details, locale)}
								</strong>
							</p>
						</div>
						{details.recurrenceFreq && (
							<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/40">
								<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
									{t("details.repeats")}
								</p>
								<p className="mt-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
									{t("details.repeatSummary", {
										freq: t(`details.freq_${details.recurrenceFreq}`),
										count: details.recurrenceInterval ?? 1,
									})}
									{details.recurrenceUntil
										? ` · ${t("details.repeatUntil", { date: details.recurrenceUntil })}`
										: ""}
								</p>
							</div>
						)}
						{(details.reminderMinutes?.length ?? 0) > 0 && (
							<div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/60 dark:bg-gray-800/40">
								<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
									{t("details.reminders")}
								</p>
								<p className="mt-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
									{details.reminderMinutes
										?.map((minutes) =>
											minutes >= 1440 ? t("eventForm.reminderDay") : t("eventForm.reminderHour"),
										)
										.join(" · ")}
								</p>
							</div>
						)}
						{details.itemKind === "TASK" && (
							<p
								className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${
									details.completed
										? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
										: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
								}`}
							>
								<Check aria-hidden="true" className="h-3.5 w-3.5" />
								{details.completed ? t("details.taskDone") : t("details.taskOpen")}
							</p>
						)}
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
								<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
								{details.type === "sampling" ? tNav("logSample") : tNav("harvest")}
							</Link>
						)}
					</div>
				)}
			</Modal>
		</div>
	);
}
