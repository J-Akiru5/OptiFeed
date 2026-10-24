"use client";

import { useRouter } from "@/i18n/routing";
import { cancelCropCycle, updateCropCycle } from "@/lib/actions/crop-cycle";
import { updatePondEvent } from "@/lib/actions/pond-event";
import { ApiClientError, apiGet } from "@/lib/api-client";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { CALENDAR_EVENT_TYPES } from "@/lib/crop-cycle/calendar";
import { addDays, daysBetween, todayDateOnly } from "@/lib/crop-cycle/dates";
import { computeCropCycleMetrics } from "@/lib/crop-cycle/metrics";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import {
	CalendarDays,
	ChevronRight,
	CircleAlert,
	CloudOff,
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
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
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
	const router = useRouter();
	const [selectedPondId, setSelectedPondId] = useState(initialPondId);
	const [allPonds, setAllPonds] = useState(false);
	const [types, setTypes] = useState<Set<CalendarEventType>>(new Set(defaultTypes));
	const [range, setRange] = useState({ from: addDays(today, -14), to: addDays(today, 45) });
	const [events, setEvents] = useState<CalendarEventDto[]>([]);
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

	const selectedPond = ponds.find((pond) => pond.id === selectedPondId);
	const selectedCycle =
		activeCycles.find((cycle) => cycle.pondId === selectedPondId) ??
		(selectedPondId === initialPondId ? activeCycle : null);
	const metrics = selectedCycle ? computeCropCycleMetrics(selectedCycle, today) : null;
	const isFallow = selectedPond?.isFallow ?? initialPondIsFallow;
	const typesKey = useMemo(() => [...types].sort().join(","), [types]);

	const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

	useEffect(() => {
		const controller = new AbortController();
		let cancelled = false;
		setLoading(true);
		setError(null);

		const params = new URLSearchParams({
			from: range.from,
			to: range.to,
			pondId: allPonds ? "all" : selectedPondId,
			types: typesKey,
			v: String(refreshKey),
		});

		apiGet<{ events: CalendarEventDto[]; truncated: boolean }>(
			`/api/calendar/events?${params.toString()}`,
			{ timeoutMs: 10_000, signal: controller.signal },
		)
			.then((data) => {
				if (cancelled) return;
				setEvents(data.events);
				setTruncated(Boolean(data.truncated));
			})
			.catch((caught) => {
				if (cancelled || controller.signal.aborted) return;
				setError(caught instanceof ApiClientError ? caught.message : t("calendar.loadError"));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
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
		if (event.kind === "HARVEST_PLANNED" && canManage && selectedCycle) {
			openEditCycle(selectedCycle);
			return;
		}
		if (event.editable && canManage && (event.kind === "MAINTENANCE" || event.kind === "OTHER")) {
			setEditingEvent(event);
			setEventFormOpen(true);
			return;
		}
		setDetails(event);
	};

	const handleDateClick = (date: string) => {
		if (!canManage || allPonds) return;
		setEditingEvent(null);
		setEventDate(date);
		setEventFormOpen(true);
	};

	const handleEventDrop = async (event: CalendarEventDto, date: string): Promise<boolean> => {
		if (!canManage) return false;
		if (event.kind === "HARVEST_PLANNED" && selectedCycle) {
			const span = daysBetween(selectedCycle.stockingDate, date);
			if (span < 30 || span > 365) {
				toast.error(t("calendar.dateRangeError"));
				return false;
			}
			const result = await updateCropCycle(
				selectedCycle.id,
				cycleToInput(selectedCycle, {
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

	const upcoming = events
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
							{recentCycles.length > 0 && (
								<div className="rounded-2xl border border-gray-100 p-4 dark:border-gray-700/60">
									<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
										{t("summary.recent")}
									</p>
									<ul className="mt-2 space-y-1.5">
										{recentCycles.map((cycle) => (
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
			<section className="rounded-[32px] border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900 sm:p-5">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<h2 className="flex items-center gap-2 text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
							<CalendarDays className="h-5 w-5" />
							{t("calendar.title")}
						</h2>
						<p className="text-xs text-gray-500 dark:text-gray-400">{t("calendar.desc")}</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
							<Fish className="h-3.5 w-3.5" />
							<select
								value={allPonds ? "all" : selectedPondId}
								onChange={(event) => {
									if (event.target.value === "all") {
										setAllPonds(true);
									} else {
										setSelectedPondId(event.target.value);
										setAllPonds(false);
									}
								}}
								className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
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

				<div className="mt-4 flex flex-wrap items-center gap-1.5">
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
				</div>

				{error && (
					<div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
						<CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
						{error}
					</div>
				)}
				{truncated && (
					<div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
						<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
						{t("calendar.truncated")}
					</div>
				)}

				<div className="relative mt-4">
					{loading && (
						<div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/60 dark:bg-gray-900/60">
							<Loader2 className="h-6 w-6 animate-spin text-[#0A3D62] dark:text-[#5b9bd5]" />
						</div>
					)}
					<CalendarView
						events={events}
						canManage={canManage}
						onRangeChange={(from, to) => {
							setRange((current) =>
								current.from === from && current.to === to ? current : { from, to },
							);
						}}
						onEventClick={handleEventClick}
						onDateClick={handleDateClick}
						onEventDrop={handleEventDrop}
					/>
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
										<span className="block text-[11px] text-gray-400">
											{event.start.slice(0, 10)}
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
				description={details ? `${details.pondName} · ${details.start.slice(0, 10)}` : undefined}
				footer={
					<div className="flex justify-end">
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
					<div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
						<p className="flex items-center gap-2">
							<Scale className="h-4 w-4 text-gray-400" />
							{t("details.pond")}: <strong>{details.pondName}</strong>
						</p>
						<p>
							{t("details.date")}: <strong>{details.start.slice(0, 10)}</strong>
						</p>
						{details.notes && <p className="text-xs text-gray-500">{details.notes}</p>}
						{details.type === "sampling" && (
							<p className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
								{t("details.samplingHint")}
							</p>
						)}
					</div>
				)}
			</Modal>
		</div>
	);
}
