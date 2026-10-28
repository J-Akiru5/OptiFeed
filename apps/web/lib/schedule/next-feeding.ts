import { PH_TZ } from "@/lib/constants";
import { farmWallClock, farmWallClockToUtc } from "@/lib/date-local";
import { computeNextFeedingSlot } from "./next-feeding-slot";

/**
 * When the feeder dispenses next, from the effective schedule.
 *
 * Kept as the `Date`-returning wrapper the feeder hero renders. It no longer
 * has its own maths: `computeNextFeedingSlot` is the single implementation of
 * the schedule spacing (it mirrors the firmware's integer arithmetic), so the
 * hero and the dashboard's next-feeding strip can never disagree.
 *
 * Creates no Date from wall-clock string or machine-local `setHours`: this
 * used to build the "next feed" in the *server's* timezone, which on Vercel is
 * UTC — eight hours off the farmer's clock. The returned Date is the real
 * instant whose Asia/Manila wall clock is the next slot; render it with
 * `formatFarmDateTime`.
 *
 * Times are stored as `@db.Time`, which Prisma hands back as a `Date` whose UTC
 * hours are the configured hour of day — hence the slot module's `getUTCHours()`.
 */
export interface NextFeedingInput {
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	now?: Date;
	timeZone?: string;
}

export function nextFeedingAt({
	scheduleStart,
	scheduleEnd,
	feedsPerDay,
	now = new Date(),
	timeZone = PH_TZ,
}: NextFeedingInput): Date {
	const slot = computeNextFeedingSlot({ scheduleStart, scheduleEnd, feedsPerDay, now, timeZone });
	const clock = farmWallClock(now, timeZone);

	if (!slot) {
		// Unreadable stored times: the next whole hour is the safest answer and
		// is still expressed in farm time.
		const fallback = new Date(now.getTime() + 60 * 60_000);
		const fallbackClock = farmWallClock(fallback, timeZone);
		return farmWallClockToUtc(fallbackClock, timeZone);
	}

	return farmWallClockToUtc(
		{
			year: clock.year,
			month: clock.month,
			day: clock.day + slot.dayOffset,
			hour: slot.hours,
			minute: slot.minutes,
		},
		timeZone,
	);
}
