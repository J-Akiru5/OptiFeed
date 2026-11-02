"use client";

import type { CalendarEventDto } from "@/lib/crop-cycle/calendar";
import { FARM_TIME_ZONE } from "@/lib/crop-cycle/dates";
import { groupDayEvents } from "@/lib/crop-cycle/day-groups";
import { AlertTriangle, ChevronRight, MousePointerClick } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

interface DayEventsPanelProps {
	/** `YYYY-MM-DD` of the day being shown. */
	day: string;
	/** Events already loaded for the visible calendar range. */
	events: CalendarEventDto[];
	labelFor: (event: CalendarEventDto) => string;
	onOpenEvent: (event: CalendarEventDto) => void;
}

/** Time for an event inside the pane; all-day events show no time. */
function eventTime(event: CalendarEventDto, locale: string): string {
	if (event.allDay) return "";
	const instant = new Date(
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(event.start)
			? `${event.start}+08:00`
			: event.start,
	);
	if (Number.isNaN(instant.getTime())) return "";
	return new Intl.DateTimeFormat(locale, {
		timeStyle: "short",
		timeZone: FARM_TIME_ZONE,
	}).format(instant);
}

/**
 * Contents of the calendar day pane (#534).
 *
 * A busy day can hold 150+ alerts, so the pane groups them by type with counts
 * instead of stacking every chip on the day cell. Device events come first:
 * they are the ones that need attention.
 */
export function DayEventsPanel({ day, events, labelFor, onOpenEvent }: DayEventsPanelProps) {
	const t = useTranslations("dashboard.harvest");
	const locale = useLocale();
	const groups = groupDayEvents(events, day);

	if (groups.length === 0) {
		return (
			<p className="flex items-center gap-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-sm font-semibold text-gray-500 dark:border-gray-700/60 dark:bg-gray-800/40 dark:text-gray-400">
				<MousePointerClick className="h-4 w-4 shrink-0" />
				{t("dayEvents.empty")}
			</p>
		);
	}

	return (
		<div className="space-y-4">
			{groups.map((group) => (
				<section key={group.type}>
					<h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
						{group.type === "device" && <AlertTriangle className="h-3.5 w-3.5 text-[#C42B3A]" />}
						{t(`filters.${group.type}`)}
						<span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
							{group.events.length}
						</span>
					</h3>
					<ul className="mt-2 space-y-1.5">
						{group.events.map((event) => {
							const time = eventTime(event, locale);
							return (
								<li key={event.id}>
									<button
										type="button"
										onClick={() => onOpenEvent(event)}
										className="flex w-full items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 text-left transition-colors hover:border-[#0A3D62]/20 hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-900 dark:hover:bg-gray-800"
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-bold text-gray-800 dark:text-gray-100">
												{labelFor(event)}
											</span>
											<span className="block truncate text-[11px] text-gray-400">
												{time ? `${time} · ` : ""}
												{event.pondName}
											</span>
										</span>
										<ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}
