"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "./harvest-calendar.css";

import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE, addDays } from "@/lib/crop-cycle/dates";
import FullCalendar from "@fullcalendar/react";
import type {
	DateClickInfo,
	DatesSetInfo,
	EventClickInfo,
	EventDropInfo,
	EventInput,
} from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

interface CalendarViewProps {
	events: CalendarEventDto[];
	canManage: boolean;
	allPonds: boolean;
	onRangeChange: (from: string, to: string) => void;
	onViewChange: (viewType: string) => void;
	onEventClick: (event: CalendarEventDto) => void;
	onDateClick: (date: string) => void;
	onEventDrop: (event: CalendarEventDto, date: string) => Promise<boolean>;
}

interface EventColors {
	color: string;
	contrastColor: string;
}

function colorsFor(event: CalendarEventDto): EventColors {
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
	onRangeChange,
	onViewChange,
	onEventClick,
	onDateClick,
	onEventDrop,
}: CalendarViewProps) {
	const t = useTranslations("dashboard.harvest");
	const [viewType, setViewType] = useState("dayGridMonth");

	const labelFor = useCallback(
		(event: CalendarEventDto): string => {
			let label: string;
			if (event.kind === "STOCKING") {
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
			}

			const colors = colorsFor(event);
			items.push({
				id,
				title: labelFor(event),
				start,
				end: event.end,
				allDay,
				display: event.display,
				color: event.display === "background" ? undefined : colors.color,
				contrastColor: event.display === "background" ? undefined : colors.contrastColor,
				editable: canManage && event.editable,
				extendedProps: { dto: event },
			});
		}

		return items;
	}, [events, canManage, labelFor, viewType]);

	const handleEventClick = (arg: EventClickInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (dto) onEventClick(dto);
	};

	const handleDateClick = (arg: DateClickInfo) => {
		if (!canManage) return;
		onDateClick(arg.dateStr.slice(0, 10));
	};

	const handleEventDrop = async (arg: EventDropInfo) => {
		const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
		if (!dto || !canManage || !dto.editable) {
			arg.revert();
			return;
		}
		const date = arg.event.startStr.slice(0, 10);
		const ok = await onEventDrop(dto, date);
		if (!ok) arg.revert();
	};

	const handleDatesSet = (arg: DatesSetInfo) => {
		const from = arg.startStr.slice(0, 10);
		const to = addDays(arg.endStr.slice(0, 10), -1);
		setViewType(arg.view.type);
		onRangeChange(from, to);
		onViewChange(arg.view.type);
	};

	return (
		<div className="harvest-calendar min-w-0">
			<FullCalendar
				plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
				initialView="dayGridMonth"
				headerToolbar={{
					left: "prev,next today",
					center: "title",
					right: "dayGridMonth,timeGridWeek,listMonth",
				}}
				// FullCalendar v7 removed the global `buttonText` map. Toolbar copy
				// now comes from these documented text options (and the theme's
				// per-view buttonTextKey), so no cast is needed.
				todayText={t("calendar.today")}
				monthText={t("calendar.month")}
				weekTextLong={t("calendar.week")}
				listText={t("calendar.list")}
				height="100%"
				firstDay={1}
				fixedWeekCount={false}
				dayMaxEvents={3}
				views={{ dayGridMonth: { displayEventTime: false } }}
				nowIndicator
				editable={canManage}
				eventStartEditable={canManage}
				eventDurationEditable={false}
				eventDisplay="block"
				timeZone={FARM_TIME_ZONE}
				scrollTime="06:00:00"
				slotMinTime="05:00:00"
				slotMaxTime="20:00:00"
				slotDuration="01:00:00"
				events={calendarEvents}
				eventClick={handleEventClick}
				dateClick={handleDateClick}
				eventDrop={handleEventDrop}
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
