"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "./harvest-calendar.css";

import { fullCalendarValueToFarmValue } from "@/lib/calendar/datetime";
import { resolveEventColor } from "@/lib/calendar/event-colors";
import { CALENDAR_TOOLBAR_VIEWS, initialCalendarView } from "@/lib/calendar/views";
import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays } from "@/lib/crop-cycle/dates";
import FullCalendar from "@fullcalendar/react";
import type {
	DateSelectInfo,
	DatesSetInfo,
	EventClickInfo,
	EventDisplayInfo,
	EventDropInfo,
	EventInput,
	EventResizeDoneInfo,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

interface CalendarViewProps {
	events: CalendarEventDto[];
	canManage: boolean;
	allPonds: boolean;
	/** Toolbar view list. Omitted = month, week, day and agenda. */
	toolbarViews?: string;
	/** Initial view. Omitted = agenda below 640 px, month otherwise. */
	defaultView?: string;
	onRangeChange: (from: string, to: string) => void;
	onViewChange: (viewType: string) => void;
	onEventClick: (event: CalendarEventDto) => void;
	onDateClick: (date: string) => void;
	onSelect: (selection: { start: string; end: string | null; allDay: boolean }) => void;
	onEventDrop: (event: CalendarEventDto, start: string, end: string | null) => Promise<boolean>;
	onEventResize: (event: CalendarEventDto, start: string, end: string | null) => Promise<boolean>;
	onToggleTask: (event: CalendarEventDto) => void;
}

interface EventColors {
	color: string;
	contrastColor: string;
}

function colorsFor(event: CalendarEventDto): EventColors {
	// Manual items respect the per-item colour and each type's accessible
	// default; the derived cycle/feeding/device sources keep their established
	// status colours.
	if (event.source === "manual") {
		return {
			color: resolveEventColor(event.color, event.kind ?? "OTHER"),
			contrastColor: "#ffffff",
		};
	}
	if (event.type === "harvest") {
		if (event.status === "cancelled") {
			return { color: "#9ca3af", contrastColor: "#ffffff" };
		}
		if (event.status === "done") {
			return { color: "#1e7b34", contrastColor: "#ffffff" };
		}
		return { color: "#ff6b35", contrastColor: "#ffffff" };
	}
	if (event.type === "sampling") {
		return { color: "#0f766e", contrastColor: "#ffffff" };
	}
	if (event.type === "manual") {
		return { color: "#7c3aed", contrastColor: "#ffffff" };
	}
	if (event.type === "device") {
		return { color: "#c42b3a", contrastColor: "#ffffff" };
	}
	return { color: "#64748b", contrastColor: "#ffffff" };
}

export function CalendarView({
	events,
	canManage,
	allPonds,
	toolbarViews,
	defaultView,
	onRangeChange,
	onViewChange,
	onEventClick,
	onDateClick,
	onSelect,
	onEventDrop,
	onEventResize,
	onToggleTask,
}: CalendarViewProps) {
	const t = useTranslations("dashboard.harvest");
	// The calendar is client-only (HarvestCalendar loads it with ssr:false), so
	// the viewport is available on the first render. Agenda is the mobile
	// default; a wider screen starts on the month grid.
	const [initialView] = useState(() =>
		defaultView
			? defaultView
			: initialCalendarView(
					typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
				),
	);
	const [viewType, setViewType] = useState(initialView);

	const labelFor = useCallback(
		(event: CalendarEventDto): string => {
			let label: string;
			if (event.source === "manual") {
				label = event.title;
			} else if (event.kind === "STOCKING") {
				label = t("event.stocking", { label: event.cycleLabel ?? event.pondName });
			} else if (event.kind === "HARVEST_PLANNED") {
				label = t("event.harvestPlanned", { label: event.cycleLabel ?? event.pondName });
			} else if (event.kind === "HARVEST_ACTUAL") {
				label = t("event.harvestActual", { label: event.cycleLabel ?? event.pondName });
			} else if (event.type === "sampling") {
				label = t("event.sampling");
			} else if (event.type === "feeding") {
				label = t("event.feeding");
			} else {
				label = event.title;
			}
			return allPonds ? `${label} · ${event.pondName}` : label;
		},
		[allPonds, t],
	);

	const calendarEvents = useMemo<EventInput[]>(() => {
		const isMonthView = viewType === "dayGridMonth";
		const renderedFeedingDays = new Set<string>();
		const items: EventInput[] = [];

		for (const event of events) {
			let { id, start } = event;
			let { allDay } = event;
			let end = event.end;

			// FullCalendar's day grid only renders background events that are
			// all-day. Collapse a day's feeding slots into one background band so
			// the Feeding filter remains useful in month view without covering the
			// day cell three times.
			if (isMonthView && event.type === "feeding") {
				const day = event.start.slice(0, 10);
				const key = `${event.pondId}:${day}`;
				if (renderedFeedingDays.has(key)) continue;
				renderedFeedingDays.add(key);
				id = `${event.id}:day`;
				start = day;
				allDay = true;
				end = undefined;
			}

			const colors = colorsFor(event);
			const isTask = event.itemKind === "TASK";
			items.push({
				id,
				title: labelFor(event),
				start,
				// All-day ends are inclusive in storage and exclusive in
				// FullCalendar, so the grid shows a two-day event on both days.
				end: allDay && end ? addDays(end.slice(0, 10), 1) : end,
				allDay,
				display: event.display,
				color: event.display === "background" ? undefined : colors.color,
				contrastColor: event.display === "background" ? undefined : colors.contrastColor,
				editable: canManage && event.editable,
				startEditable: canManage && event.editable,
				// A task has a due date, not a duration; only Events resize.
				durationEditable: canManage && event.editable && !isTask,
				classNames: event.completed ? ["ofc-event-done"] : undefined,
				extendedProps: { dto: event },
			});
		}

		return items;
	}, [events, canManage, labelFor, viewType]);

	const handleEventClick = (arg: EventClickInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (dto) onEventClick(dto);
	};

	const handleDateClick = (arg: { dateStr: string }) => {
		if (!canManage) return;
		onDateClick(arg.dateStr.slice(0, 10));
	};

	const handleSelect = (arg: DateSelectInfo) => {
		if (!canManage) return;
		onSelect({
			start: fullCalendarValueToFarmValue(arg.startStr, arg.allDay),
			end: arg.endStr ? fullCalendarValueToFarmValue(arg.endStr, arg.allDay) : null,
			allDay: arg.allDay,
		});
	};

	const handleEventDrop = async (arg: EventDropInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (!dto || !canManage || !dto.editable) {
			arg.revert();
			return;
		}
		const ok = await onEventDrop(dto, arg.event.startStr, arg.event.endStr ?? null);
		if (!ok) arg.revert();
	};

	const handleEventResize = async (arg: EventResizeDoneInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (!dto || !canManage || !dto.editable) {
			arg.revert();
			return;
		}
		const ok = await onEventResize(dto, arg.event.startStr, arg.event.endStr ?? null);
		if (!ok) arg.revert();
	};

	const handleDatesSet = (arg: DatesSetInfo) => {
		const from = arg.startStr.slice(0, 10);
		const to = addDays(arg.endStr.slice(0, 10), -1);
		setViewType(arg.view.type);
		onRangeChange(from, to);
		onViewChange(arg.view.type);
	};

	const renderEventContent = (arg: EventDisplayInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (!dto || dto.itemKind !== "TASK" || dto.display === "background") return true;
		// A task on a pond the caller cannot write (an org-wide event on the
		// farmer calendar) stays visible but the checkbox is disabled.
		const canToggleTask = canManage && Boolean(dto.editable);
		return (
			<span className="flex min-w-0 items-center gap-1 overflow-hidden">
				<button
					type="button"
					disabled={!canToggleTask}
					aria-label={
						dto.completed
							? t("task.reopenLabel", { title: dto.title })
							: t("task.completeLabel", { title: dto.title })
					}
					aria-pressed={Boolean(dto.completed)}
					onClick={(click) => {
						click.stopPropagation();
						if (!canToggleTask) return;
						onToggleTask(dto);
					}}
					onMouseDown={(down) => down.stopPropagation()}
					onTouchStart={(touch) => touch.stopPropagation()}
					className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
						dto.completed
							? "border-transparent bg-white/90 text-[#0A3D62]"
							: "border-white/70 bg-transparent text-transparent"
					} ${canToggleTask ? "cursor-pointer" : "cursor-default"}`}
				>
					<Check className="h-3 w-3" aria-hidden="true" />
				</button>
				<span
					className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${
						dto.completed ? "line-through opacity-70" : ""
					}`}
				>
					{arg.timeText ? `${arg.timeText} ` : ""}
					{arg.event.title}
				</span>
			</span>
		);
	};

	return (
		<div
			className="harvest-calendar min-w-0"
			// Day cells only show a hand when a click creates an event (#244);
			// `data-calendar-editable` mirrors the `selectable`/`editable` props.
			data-calendar-editable={canManage ? "true" : undefined}
		>
			<FullCalendar
				plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
				initialView={initialView}
				headerToolbar={{
					left: "prev,next today",
					center: "title",
					right: toolbarViews ?? CALENDAR_TOOLBAR_VIEWS,
				}}
				// FullCalendar v7 removed the global `buttonText` map. Toolbar copy
				// now comes from these documented text options (and the theme's
				// per-view buttonTextKey), so no cast is needed.
				todayText={t("calendar.today")}
				monthText={t("calendar.month")}
				weekTextLong={t("calendar.week")}
				dayText={t("calendar.day")}
				listText={t("calendar.agenda")}
				height="100%"
				firstDay={1}
				fixedWeekCount={false}
				dayMaxEvents={3}
				views={{ dayGridMonth: { displayEventTime: false } }}
				nowIndicator
				editable={canManage}
				selectable={canManage}
				selectMirror
				eventStartEditable={canManage}
				eventDurationEditable={canManage}
				// Long-press makes drag/resize/select usable on a touch screen.
				longPressDelay={300}
				selectLongPressDelay={300}
				eventLongPressDelay={300}
				eventDisplay="block"
				timeZone={FARM_TIME_ZONE}
				scrollTime="06:00:00"
				slotMinTime="05:00:00"
				slotMaxTime="20:00:00"
				slotDuration="01:00:00"
				events={calendarEvents}
				eventClick={handleEventClick}
				dateClick={handleDateClick}
				select={handleSelect}
				eventDrop={handleEventDrop}
				eventResize={handleEventResize}
				eventContent={renderEventContent}
				datesSet={handleDatesSet}
				eventDidMount={(info) => {
					info.el.setAttribute("title", info.event.title);
				}}
				noEventsText={t("calendar.noEvents")}
				headerToolbarClass="ofc-toolbar"
				toolbarClass="ofc-toolbar-row"
				toolbarSectionClass={(info) => `ofc-toolbar-${info.name}`}
				toolbarTitleClass="ofc-title"
				buttonGroupClass="ofc-btn-group"
				buttonClass={(info) =>
					`ofc-btn${info.isSelected ? " ofc-btn-selected" : ""}${
						info.isIconOnly ? " ofc-btn-icon" : ""
					}`
				}
				viewClass="ofc-view"
				tableClass="ofc-table"
				tableHeaderClass="ofc-table-header"
				tableBodyClass="ofc-table-body"
				dayHeaderClass="ofc-day-header-cell"
				dayHeaderInnerClass="ofc-day-header"
				dayHeaderRowClass="ofc-day-header-row"
				dayCellClass="ofc-day-cell"
				dayCellTopClass="ofc-day-top"
				dayCellTopInnerClass="ofc-day-number"
				dayRowClass="ofc-day-row"
				eventClass="ofc-event"
				eventInnerClass="ofc-event-inner"
				eventTitleClass="ofc-event-title"
				eventTimeClass="ofc-event-time"
				blockEventClass="ofc-event"
				blockEventInnerClass="ofc-event-inner"
				blockEventTitleClass="ofc-event-title"
				blockEventTimeClass="ofc-event-time"
				rowEventClass="ofc-event"
				rowEventInnerClass="ofc-event-inner"
				rowEventTitleClass="ofc-event-title"
				rowEventTimeClass="ofc-event-time"
				columnEventClass="ofc-event"
				columnEventInnerClass="ofc-event-inner"
				columnEventTitleClass="ofc-event-title"
				columnEventTimeClass="ofc-event-time"
				backgroundEventClass="ofc-bg-event"
				listItemEventClass="ofc-list-event"
				listItemEventInnerClass="ofc-list-event-inner"
				listItemEventTitleClass="ofc-list-event-title"
				listItemEventTimeClass="ofc-list-event-time"
				listDayHeaderClass="ofc-list-day"
				listDayHeaderInnerClass="ofc-list-day-inner"
				moreLinkClass="ofc-more"
				moreLinkInnerClass="ofc-more-inner"
				noEventsClass="ofc-no-events"
				noEventsInnerClass="ofc-no-events-inner"
				slotHeaderClass="ofc-slot-header"
				slotHeaderInnerClass="ofc-slot-label"
				slotHeaderRowClass="ofc-slot-header-row"
				slotLaneClass="ofc-slot"
			/>
		</div>
	);
}
