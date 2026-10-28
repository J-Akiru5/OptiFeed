"use client";

import { CalendarTypeFilters, calendarChipClass } from "@/components/harvest/calendar-controls";
import { Modal } from "@/components/harvest/modal";
import { Card, SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { ApiClientError, apiGet } from "@/lib/api-client";
import type {
	PlatformCalendarData,
	PlatformCalendarEvent,
	PlatformCalendarOrgOption,
	PlatformCalendarPondOption,
} from "@/lib/calendar/platform-events";
import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays, todayDateOnly } from "@/lib/crop-cycle/dates";
import { cn } from "@/lib/utils";
import { ChevronRight, CircleAlert, Filter, Fish, Loader2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CalendarView = dynamic(
	() => import("@/components/harvest/calendar-view").then((module) => module.CalendarView),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-80 items-center justify-center rounded-2xl border border-gray-200 bg-white">
				<Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-[#0A3D62]" />
			</div>
		),
	},
);

const PLATFORM_TYPES: CalendarEventType[] = ["harvest", "sampling", "manual", "device"];

const TYPE_DOT: Record<CalendarEventType, string> = {
	harvest: "bg-[#FF6B35]",
	sampling: "bg-teal-600",
	manual: "bg-violet-600",
	device: "bg-[#C42B3A]",
	feeding: "bg-slate-500",
};

interface PlatformCalendarProps {
	initialData: PlatformCalendarData;
}

function formatMoment(event: CalendarEventDto, locale: string): string {
	const raw = event.start;
	let instant: Date | null = null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		instant = new Date(`${raw}T00:00:00+08:00`);
	} else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
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

/**
 * Read-only platform calendar (E16.2).
 *
 * Filter state is mirrored into the URL, and the data comes from the
 * platform-gated API. `CalendarView` is the farmer calendar's grid, so
 * month/week/list, colours, recurrence labels and the touch behaviour are the
 * same; `canManage` is always false here, which keeps every tenant item
 * read-only.
 */
export function PlatformCalendar({ initialData }: PlatformCalendarProps) {
	const t = useTranslations("superadmin.calendar");
	const tHarvest = useTranslations("dashboard.harvest");
	const locale = useLocale();
	const orgs: PlatformCalendarOrgOption[] = initialData.orgs;
	const ponds: PlatformCalendarPondOption[] = initialData.ponds;
	const [events, setEvents] = useState<PlatformCalendarEvent[]>(initialData.events);
	const [truncated, setTruncated] = useState(initialData.truncated);
	const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(initialData.filters.orgIds);
	const [pondId, setPondId] = useState(initialData.filters.pondId);
	const [types, setTypes] = useState<CalendarEventType[]>(initialData.filters.types);
	const [range, setRange] = useState({ from: initialData.from, to: initialData.to });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [details, setDetails] = useState<PlatformCalendarEvent | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [upcomingEvents, setUpcomingEvents] = useState<PlatformCalendarEvent[]>([]);
	const requestId = useRef(0);
	const today = todayDateOnly();

	const typesKey = useMemo(() => types.slice().sort().join(","), [types]);

	const availablePonds = useMemo(() => {
		if (selectedOrgIds.length === 0) return ponds;
		const selected = new Set(selectedOrgIds);
		return ponds.filter((pond) => pond.orgIds.some((orgId) => selected.has(orgId)));
	}, [ponds, selectedOrgIds]);

	// A shared URL can combine an org filter with a pond outside it. Fall back
	// to "all ponds" rather than leaving the select on an option it no longer
	// offers.
	useEffect(() => {
		if (pondId !== "all" && !availablePonds.some((pond) => pond.id === pondId)) setPondId("all");
	}, [availablePonds, pondId]);

	// Filters live in the URL so a platform admin can share exactly what they
	// are looking at. `replaceState` keeps the browser history clean.
	useEffect(() => {
		const params = new URLSearchParams();
		if (selectedOrgIds.length > 0) params.set("orgs", selectedOrgIds.slice().sort().join(","));
		if (pondId !== "all") params.set("pond", pondId);
		if (typesKey) params.set("types", typesKey);
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}, [selectedOrgIds, pondId, typesKey]);

	useEffect(() => {
		const controller = new AbortController();
		const current = ++requestId.current;
		setLoading(true);
		setError(null);

		const params = new URLSearchParams({
			from: range.from,
			to: range.to,
			pond: pondId,
			types: typesKey,
			refresh: String(refreshKey),
		});
		if (selectedOrgIds.length > 0) params.set("orgs", selectedOrgIds.join(","));

		apiGet<PlatformCalendarData>(`/api/platform/calendar/events?${params.toString()}`, {
			timeoutMs: 10_000,
			signal: controller.signal,
		})
			.then((data) => {
				if (controller.signal.aborted || current !== requestId.current) return;
				setEvents(data.events);
				setTruncated(data.truncated);
			})
			.catch((caught) => {
				if (controller.signal.aborted || current !== requestId.current) return;
				setError(caught instanceof ApiClientError ? caught.message : t("loadError"));
			})
			.finally(() => {
				if (!controller.signal.aborted && current === requestId.current) setLoading(false);
			});

		return () => controller.abort();
	}, [range.from, range.to, pondId, typesKey, refreshKey, selectedOrgIds, t]);

	// Next events, independent of the visible range. Same behaviour as the
	// farmer calendar: browsing a past week must not empty the strip.
	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({
			from: today,
			to: addDays(today, 45),
			pond: pondId,
			types: typesKey,
			refresh: String(refreshKey),
		});
		if (selectedOrgIds.length > 0) params.set("orgs", selectedOrgIds.join(","));

		apiGet<PlatformCalendarData>(`/api/platform/calendar/events?${params.toString()}`, {
			timeoutMs: 10_000,
			signal: controller.signal,
		})
			.then((data) => {
				if (!controller.signal.aborted) setUpcomingEvents(data.events);
			})
			.catch(() => {
				// The grid's error banner is authoritative; keep the last list.
			});

		return () => controller.abort();
	}, [today, pondId, typesKey, refreshKey, selectedOrgIds]);

	const upcoming = useMemo(
		() =>
			upcomingEvents
				.filter((event) => event.start.slice(0, 10) >= today)
				.sort((a, b) => a.start.localeCompare(b.start))
				.slice(0, 5),
		[upcomingEvents, today],
	);

	const toggleOrg = (orgId: string) => {
		const next = selectedOrgIds.includes(orgId)
			? selectedOrgIds.filter((id) => id !== orgId)
			: [...selectedOrgIds, orgId];
		setSelectedOrgIds(next);

		if (pondId === "all") return;
		const selected = new Set(next);
		const stillVisible =
			next.length === 0 ||
			ponds.some(
				(pond) => pond.id === pondId && pond.orgIds.some((candidate) => selected.has(candidate)),
			);
		if (!stillVisible) setPondId("all");
	};

	const toggleType = (type: CalendarEventType) => {
		const next = types.includes(type) ? types.filter((value) => value !== type) : [...types, type];
		setTypes(next.length === 0 ? [...PLATFORM_TYPES] : next);
	};

	const translatedTitle = useCallback(
		(event: PlatformCalendarEvent): string => {
			if (event.kind === "OTA_WINDOW") return t("ota.title");
			if (event.type === "device" && event.deviceEventType) {
				const key = `device.${event.deviceEventType}`;
				return t.has(key) ? t(key) : event.title;
			}
			if (event.type === "sampling") return tHarvest("event.sampling");
			if (event.source !== "manual") {
				if (event.kind === "STOCKING") {
					return tHarvest("event.stocking", { label: event.cycleLabel ?? event.pondName });
				}
				if (event.kind === "HARVEST_PLANNED") {
					return tHarvest("event.harvestPlanned", {
						label: event.cycleLabel ?? event.pondName,
					});
				}
				if (event.kind === "HARVEST_ACTUAL") {
					return tHarvest("event.harvestActual", {
						label: event.cycleLabel ?? event.pondName,
					});
				}
			}
			return event.title;
		},
		[t, tHarvest],
	);

	const displayEvents = useMemo(
		() => events.map((event) => ({ ...event, title: translatedTitle(event) })),
		[events, translatedTitle],
	);

	const detailById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);

	const handleEventClick = useCallback(
		(event: CalendarEventDto) => {
			setDetails(detailById.get(event.id) ?? null);
		},
		[detailById],
	);

	const typeLabel = (type: CalendarEventType) => {
		const key = `types.${type}`;
		return t.has(key) ? t(key) : type;
	};

	return (
		<div className="space-y-4">
			<div className="flex min-h-0 flex-col gap-4 xl:flex-row">
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<Card className="min-w-0 overflow-hidden">
						<div className="flex flex-none flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
							<fieldset
								aria-label={t("filters.orgsLabel")}
								className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
							>
								<span className="mr-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
									<Filter aria-hidden="true" className="h-3 w-3" />
									{t("filters.orgsLabel")}
								</span>
								<button
									type="button"
									onClick={() => {
										setSelectedOrgIds([]);
										setPondId("all");
									}}
									aria-pressed={selectedOrgIds.length === 0}
									className={calendarChipClass(selectedOrgIds.length === 0)}
								>
									{t("filters.allOrgs")}
								</button>
								{orgs.map((org) => {
									const active = selectedOrgIds.includes(org.id);
									return (
										<button
											key={org.id}
											type="button"
											onClick={() => toggleOrg(org.id)}
											aria-pressed={active}
											className={calendarChipClass(active, "max-w-full")}
										>
											<span className="truncate">{org.name}</span>
										</button>
									);
								})}
							</fieldset>

							<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
								<CalendarTypeFilters
									types={PLATFORM_TYPES}
									isSelected={(type) => types.includes(type)}
									onToggle={toggleType}
									label={t("filters.typesLabel")}
									labelFor={typeLabel}
									hideIcon
								/>

								<label className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-[#3D5568]">
									<Fish aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
									<span className="sr-only">{t("filters.pondLabel")}</span>
									<select
										value={pondId}
										onChange={(event) => setPondId(event.target.value)}
										className="max-w-[16rem] min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-[#0A3D62]"
									>
										<option value="all">{t("filters.allPonds")}</option>
										{availablePonds.map((pond) => (
											<option key={pond.id} value={pond.id}>
												{pond.name}
											</option>
										))}
									</select>
								</label>

								<div className="flex items-center gap-2 sm:ml-auto">
									<span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
										<span aria-hidden="true" className="h-2 w-4 rounded-sm bg-slate-400/40" />
										{t("ota.legend")}
									</span>
									<button
										type="button"
										onClick={() => setRefreshKey((value) => value + 1)}
										disabled={loading}
										className={cn(SECONDARY_BUTTON, "min-h-11")}
									>
										<RefreshCw
											aria-hidden="true"
											className={cn("h-3.5 w-3.5", loading && "animate-spin")}
										/>
										{t("refresh")}
									</button>
								</div>
							</div>

							{error && (
								<div
									role="alert"
									className="flex flex-col gap-2 rounded-2xl border border-[#C42B3A]/30 bg-[#FDE8EA] p-3 text-xs font-bold text-[#C42B3A] sm:flex-row sm:items-center dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
								>
									<CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
									<p className="min-w-0 flex-1">{error}</p>
									<button
										type="button"
										onClick={() => setRefreshKey((value) => value + 1)}
										className={SECONDARY_BUTTON}
									>
										{t("retry")}
									</button>
								</div>
							)}

							{truncated && (
								<div className="flex items-start gap-2 rounded-2xl border border-[#E85A2A]/30 bg-[#FFF3E8] p-3 text-xs font-bold text-[#B45309] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
									<CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
									{t("truncated")}
								</div>
							)}
						</div>
						<div className="relative min-h-[420px] px-2 pb-2 pt-2 sm:px-3" aria-busy={loading}>
							{loading && (
								<div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-[#0A3D62]/10">
									<div className="h-full w-1/3 animate-pulse rounded-full bg-[#0A3D62]" />
								</div>
							)}
							<div className="h-[62vh] min-h-[420px] xl:h-[calc(100dvh-19rem)]">
								<CalendarView
									events={displayEvents}
									canManage={false}
									allPonds
									onRangeChange={(from, to) => {
										setRange((current) =>
											current.from === from && current.to === to ? current : { from, to },
										);
									}}
									onViewChange={() => {}}
									onEventClick={handleEventClick}
									onDateClick={() => {}}
									onSelect={() => {}}
									onEventDrop={async () => false}
									onEventResize={async () => false}
									onToggleTask={() => {}}
								/>
							</div>
						</div>
					</Card>
				</div>

				<aside className="flex w-full flex-col gap-4 xl:w-[300px] xl:flex-none">
					<Card className="flex min-h-0 flex-col p-4 xl:flex-1 xl:overflow-hidden">
						<div className="flex flex-none items-center justify-between gap-3">
							<h2 className="text-base font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{tHarvest("upcoming.title")}
							</h2>
							<span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
								{tHarvest("upcoming.next", { count: upcoming.length })}
							</span>
						</div>
						{upcoming.length === 0 ? (
							<p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
								{tHarvest("upcoming.empty")}
							</p>
						) : (
							<ul
								aria-label={tHarvest("upcoming.listLabel")}
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
												aria-hidden="true"
												className={cn("h-2.5 w-2.5 shrink-0 rounded-full", TYPE_DOT[event.type])}
											/>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">
													{translatedTitle(event)}
												</span>
												<span className="block truncate text-[11px] text-gray-400">
													{formatMoment(event, locale)}
												</span>
											</span>
											<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-300" />
										</button>
									</li>
								))}
							</ul>
						)}
					</Card>
				</aside>
			</div>

			<Modal
				open={Boolean(details)}
				side="right"
				size="md"
				onClose={() => setDetails(null)}
				title={details ? translatedTitle(details) : ""}
				description={
					details
						? `${details.pondName || t("detail.noPond")} · ${formatMoment(details, locale)}`
						: undefined
				}
				footer={
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
						{details?.orgIds[0] && (
							<Link href={`/superadmin/orgs/${details.orgIds[0]}`} className={SECONDARY_BUTTON}>
								{t("detail.openOrg")}
							</Link>
						)}
						{details?.pondName && (
							<Link
								href={{
									pathname: "/superadmin/ponds",
									query: { q: details.pondName },
								}}
								className={SECONDARY_BUTTON}
							>
								{t("detail.openPond")}
							</Link>
						)}
						<button type="button" onClick={() => setDetails(null)} className={SECONDARY_BUTTON}>
							{tHarvest("details.close")}
						</button>
					</div>
				}
			>
				{details && (
					<div className="space-y-4 text-sm text-[#3D5568]">
						<div className="flex flex-wrap items-center gap-2">
							<span
								aria-hidden="true"
								className={cn("h-2.5 w-2.5 rounded-full", TYPE_DOT[details.type])}
							/>
							<span className="rounded-full bg-[#F4F7F6] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#3D5568]">
								{details.kind === "OTA_WINDOW" ? t("ota.title") : typeLabel(details.type)}
							</span>
						</div>

						<dl className="grid gap-3 sm:grid-cols-2">
							<div>
								<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
									{t("detail.org")}
								</dt>
								<dd className="mt-0.5 text-xs font-bold text-[#0A3D62]">
									{details.orgNames.length === 0 ? (
										t("detail.noOrg")
									) : details.orgIds.length === 1 ? (
										<Link
											href={`/superadmin/orgs/${details.orgIds[0]}`}
											className="underline decoration-[#E85A2A] decoration-2 underline-offset-2"
										>
											{details.orgNames.join(", ")}
										</Link>
									) : (
										details.orgNames.join(", ")
									)}
								</dd>
							</div>
							<div>
								<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
									{t("detail.pond")}
								</dt>
								<dd className="mt-0.5 text-xs font-bold text-[#0A3D62]">
									{details.pondName ? (
										<Link
											href={{
												pathname: "/superadmin/ponds",
												query: { q: details.pondName },
											}}
											className="underline decoration-[#E85A2A] decoration-2 underline-offset-2"
										>
											{details.pondName}
										</Link>
									) : (
										t("detail.noPond")
									)}
								</dd>
							</div>
							<div>
								<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
									{t("detail.when")}
								</dt>
								<dd className="mt-0.5 text-xs font-bold text-[#0A3D62]">
									{formatMoment(details, locale)}
								</dd>
							</div>
							<div>
								<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
									{t("detail.who")}
								</dt>
								<dd className="mt-0.5 text-xs font-bold text-[#0A3D62]">
									{details.createdByName ?? t("detail.unknownWho")}
								</dd>
							</div>
							{details.cycleLabel && (
								<div>
									<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
										{t("detail.cycle")}
									</dt>
									<dd className="mt-0.5 text-xs font-bold text-[#0A3D62]">{details.cycleLabel}</dd>
								</div>
							)}
							{details.notes && (
								<div className="sm:col-span-2">
									<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
										{t("detail.notes")}
									</dt>
									<dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[#3D5568]">
										{details.notes}
									</dd>
								</div>
							)}
						</dl>

						{details.kind === "OTA_WINDOW" && (
							<p className="rounded-xl bg-[#F4F7F6] p-3 text-xs text-[#3D5568]">
								{t("ota.description")}
							</p>
						)}

						<p className="text-[11px] text-[#3D5568]">{t("detail.writeHint")}</p>
					</div>
				)}
			</Modal>
		</div>
	);
}
