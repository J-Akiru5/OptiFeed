import { parseClock } from "./slots";

/**
 * Why a feeding window cannot describe the requested schedule.
 *
 * A window where the first and last feed are the same clock time is only
 * meaningful for a single meal. With two or more meals the even spacing
 * collapses every slot onto one instant, which the firmware cannot run and the
 * preview renders as N identical times (#763).
 */
export type ScheduleWindowIssue = "invalidStart" | "invalidEnd" | "zeroLength";

/**
 * Validate the first/last feed fields before they are sent to the server.
 *
 * Overnight windows (end earlier than start) are valid: the feeder runs past
 * midnight. Only an exact zero-length window with more than one feed is
 * rejected, matching `feedingSlotMinutes`' own interval rule.
 */
export function validateScheduleWindow(
	scheduleStart: string,
	scheduleEnd: string,
	feedsPerDay: number,
): ScheduleWindowIssue | null {
	const start = parseClock(scheduleStart);
	if (start === null) return "invalidStart";

	const end = parseClock(scheduleEnd);
	if (end === null) return "invalidEnd";

	if (feedsPerDay > 1 && start === end) return "zeroLength";

	return null;
}
