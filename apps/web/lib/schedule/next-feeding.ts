import { farmWallClock, farmWallClockToInstant } from "@/lib/date-local";
import { computeNextFeedingSlot } from "./next-feeding-slot";

/**
 * When the feeder dispenses next, from the effective schedule.
 *
 * The firmware spreads `feedsPerDay` meals evenly between the start and end
 * hour, so the slot list is `start + i * interval` (see
 * `computeNextFeedingSlot`, which owns the farm wall-clock maths and the
 * overnight-window handling).
 *
 * `Pond.scheduleStart` / `scheduleEnd` are stored as `@db.Time` and read back
 * with the farm wall-clock hour in their UTC components. This resolves the slot
 * to a real instant in the farm's timezone (`Asia/Manila`); using `setHours`
 * would follow the runtime timezone and render eight hours off on Vercel.
 */
export interface NextFeedingInput {
	scheduleStart: Date;
	scheduleEnd: Date;
	feedsPerDay: number;
	now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function nextFeedingAt({
	scheduleStart,
	scheduleEnd,
	feedsPerDay,
	now = new Date(),
}: NextFeedingInput): Date {
	const clock = farmWallClock(now);
	const slot = computeNextFeedingSlot({ scheduleStart, scheduleEnd, feedsPerDay, now });

	if (!slot) {
		// Invalid stored times: keep the old "tomorrow at the start hour" shape
		// when the start hour is usable, otherwise one day from now.
		const startHour = scheduleStart.getUTCHours();
		const startMinute = scheduleStart.getUTCMinutes();
		if (Number.isFinite(startHour) && Number.isFinite(startMinute)) {
			const tomorrow = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + 1));
			return farmWallClockToInstant({
				year: tomorrow.getUTCFullYear(),
				month: tomorrow.getUTCMonth() + 1,
				day: tomorrow.getUTCDate(),
				hour: startHour,
				minute: startMinute,
			});
		}
		return new Date(now.getTime() + DAY_MS);
	}

	const day = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + slot.dayOffset));
	return farmWallClockToInstant({
		year: day.getUTCFullYear(),
		month: day.getUTCMonth() + 1,
		day: day.getUTCDate(),
		hour: slot.hours,
		minute: slot.minutes,
	});
}
