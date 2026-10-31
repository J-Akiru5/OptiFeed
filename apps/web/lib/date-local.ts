import { PH_TZ } from "@/lib/constants";

// Helpers to format dates using our custom translation map for Hiligaynon
// support. Farm data is displayed in the farm's own timezone (Asia/Manila,
// decision: display is Manila, storage is UTC), so server-rendered pages must
// not fall back to the runtime's timezone — on Vercel that is UTC and every
// time would be eight hours behind the farmer's wall clock.

export interface FarmWallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
}

/** Wall-clock parts of `date` in `timeZone` (default Asia/Manila). */
export function farmWallClock(date: Date, timeZone: string = PH_TZ): FarmWallClock {
	if (!Number.isFinite(date.getTime())) {
		return {
			year: Number.NaN,
			month: Number.NaN,
			day: Number.NaN,
			hour: Number.NaN,
			minute: Number.NaN,
		};
	}
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return {
		year: Number(parts.get("year")),
		month: Number(parts.get("month")),
		day: Number(parts.get("day")),
		hour: Number(parts.get("hour")),
		minute: Number(parts.get("minute")),
	};
}

/** Format a local `Date`'s components with the translated day and month names. */
export function formatDateTimeLocal(date: Date, tDates: (key: string) => string) {
	const enDay = date.toLocaleString("en-US", { weekday: "short" });
	const enMonth = date.toLocaleString("en-US", { month: "short" });

	const localizedDay = tDates(`days.${enDay}`);
	const localizedMonth = tDates(`months.${enMonth}`);
	const dayOfMonth = date.getDate();

	const hours = date.getHours();
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const ampm = hours >= 12 ? tDates("pm") : tDates("am");
	const hr12 = hours % 12 || 12;

	return {
		date: `${localizedMonth} ${dayOfMonth}`, // e.g., "Jul 8" or "Hul 8"
		time: `${hr12}:${minutes} ${ampm}`, // e.g., "4:19 AM"
		fullDate: `${localizedDay}, ${localizedMonth} ${dayOfMonth}`, // e.g., "Wed, Jul 8"
		full: `${localizedDay}, ${localizedMonth} ${dayOfMonth} • ${hr12}:${minutes} ${ampm}`,
	};
}

/**
 * Format a stored instant in the farm's timezone (Asia/Manila), independent of
 * the runtime timezone. Use this for every farm-facing date and time in a
 * server component and in shared components that render on the server.
 *
 * The farm wall-clock parts are rebuilt as a local `Date` so the existing
 * formatter can render them with the translated day and month names in any
 * locale.
 */
export function formatFarmDateTime(date: Date, tDates: (key: string) => string) {
	const clock = farmWallClock(date);
	if (!Number.isFinite(clock.year) || !Number.isFinite(clock.hour)) {
		return formatDateTimeLocal(date, tDates);
	}
	const local = new Date(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, 0, 0);
	return formatDateTimeLocal(local, tDates);
}

/** Format an already-resolved farm wall-clock time (hours/minutes) for display. */
export function formatWallClockTime(
	hours: number,
	minutes: number,
	tDates: (key: string) => string,
): string {
	const hour = ((Math.trunc(hours) % 24) + 24) % 24;
	const minute = ((Math.trunc(minutes) % 60) + 60) % 60;
	const anchor = new Date(2000, 0, 1, hour, minute, 0, 0);
	return formatDateTimeLocal(anchor, tDates).time;
}
