"use client";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "./harvest-calendar.css";

import type { CalendarEventDto, CalendarEventType } from "@/lib/crop-cycle/calendar";
import { addDays } from "@/lib/crop-cycle/dates";
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
import { useCallback, useMemo } from "react";

interface CalendarViewProps {
	events: CalendarEventDto[];
	canManage: boolean;
	onRangeChange: (from: string, to: string) => void;
	onEventClick: (event: CalendarEventDto) => void;
	onDateClick: (date: string) => void;
	onEventDrop: (event: CalendarEventDto, date: string) => Promise<boolean>;
}

interface EventColors {
	backgroundColor: string;
	borderColor: string;
	textColor: string;
}

function colorsFor(event: CalendarEventDto): EventColors {
	if (event.type === "harvest") {
		if (event.status === "cancelled") {
			return { backgroundColor: "#9ca3af", borderColor: "#9ca3af", textColor: "#ffffff" };
		}
		if (event.status === "done") {
			return { backgroundColor: "#1e7b34", borderColor: "#1e7b34", textColor: "#ffffff" };
		}
		return { backgroundColor: "#ff6b35", borderColor: "#ff6b35", textColor: "#ffffff" };
	}
	if (event.type === "sampling") {
		return { backgroundColor: "#0f766e", borderColor: "#0f766e", textColor: "#ffffff" };
	}
	if (event.type === "manual") {
		return { backgroundColor: "#7c3aed", borderColor: "#7c3aed", textColor: "#ffffff" };
	}
	if (event.type === "device") {
		return { backgroundColor: "#c42b3a", borderColor: "#c42b3a", textColor: "#ffffff" };
	}
	return { backgroundColor: "#64748b", borderColor: "#64748b", textColor: "#ffffff" };
}

export function CalendarView({
	events,
	canManage,
	onRangeChange,
	onEventClick,
	onDateClick,
	onEventDrop,
}: CalendarViewProps) {
	const t = useTranslations("dashboard.harvest");

	const labelFor = useCallback(
		(event: CalendarEventDto): string => {
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
			if (event.type === "device") return event.title;
			return event.title;
		},
		[t],
	);

	const calendarEvents = useMemo<EventInput[]>(
		() =>
			events.map((event) => {
				const colors = colorsFor(event);
				return {
					id: event.id,
					title: labelFor(event),
					start: event.start,
					end: event.end,
					allDay: event.allDay,
					display: event.display,
					backgroundColor: event.display === "background" ? undefined : colors.backgroundColor,
					borderColor: event.display === "background" ? undefined : colors.borderColor,
					textColor: event.display === "background" ? undefined : colors.textColor,
					editable: canManage && event.editable,
					extendedProps: { dto: event },
				};
			}),
		[events, canManage, labelFor],
	);

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
		onRangeChange(from, to);
	};

	return (
		<div className="harvest-calendar">
			<FullCalendar
				plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
				initialView="dayGridMonth"
				headerToolbar={{
					left: "prev,next today",
					center: "title",
					right: "dayGridMonth,timeGridWeek,listMonth",
				}}
				height="auto"
				firstDay={1}
				dayMaxEvents={3}
				nowIndicator
				editable={canManage}
				eventStartEditable={canManage}
				eventDurationEditable={false}
				eventDisplay="block"
				events={calendarEvents}
				eventClick={handleEventClick}
				dateClick={handleDateClick}
				eventDrop={handleEventDrop}
				datesSet={handleDatesSet}
				eventContent={(arg) => {
					const dto = arg.event.extendedProps.dto as CalendarEventDto | undefined;
					if (dto?.display === "background") return null;
					return (
						<div className="flex min-w-0 items-center gap-1 px-0.5">
							<span className="truncate">{arg.event.title}</span>
						</div>
					);
				}}
				noEventsText={t("calendar.noEvents")}
			/>
		</div>
	);
}

// Keep the event-type union referenced so the import stays useful if the
// component grows type-specific rendering later.
export type { CalendarEventType };
