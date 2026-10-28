import { farmWallClock } from "@/lib/date-local";
import { nextFeedingAt } from "@/lib/schedule/next-feeding";
import { describe, expect, it } from "vitest";

/** `@db.Time` values arrive as a Date whose UTC hours are the configured hour. */
function at(hour: number, minute = 0): Date {
	return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

/** An instant whose Asia/Manila wall clock is `hour:minute` on 27 Oct 2026. */
function manila(hour: number, minute = 0, day = 27): Date {
	return new Date(Date.UTC(2026, 9, day, hour - 8, minute, 0, 0));
}

function farmParts(date: Date) {
	const clock = farmWallClock(date);
	return { day: clock.day, hour: clock.hour, minute: clock.minute };
}

describe("nextFeedingAt", () => {
	it("returns the next slot later today, as a real instant", () => {
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now: manila(11),
		});

		expect(farmParts(next)).toEqual({ day: 27, hour: 12, minute: 0 });
		// 12:00 in Asia/Manila is 04:00 UTC — the value is timezone-independent.
		expect(next.getTime()).toBe(Date.UTC(2026, 9, 27, 4, 0));
	});

	it("rolls over to tomorrow's first slot after the last one", () => {
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now: manila(17, 30),
		});

		expect(farmParts(next)).toEqual({ day: 28, hour: 8, minute: 0 });
	});

	it("uses the start hour when there is a single meal", () => {
		const next = nextFeedingAt({
			scheduleStart: at(6),
			scheduleEnd: at(18),
			feedsPerDay: 1,
			now: manila(20),
		});

		expect(farmParts(next)).toEqual({ day: 28, hour: 6, minute: 0 });
	});

	it("never divides by zero on a bad schedule", () => {
		const now = manila(7);
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(8),
			feedsPerDay: 0,
			now,
		});

		expect(next.getTime()).toBeGreaterThan(now.getTime());
		expect(farmParts(next)).toEqual({ day: 27, hour: 8, minute: 0 });
	});

	it("agrees with the dashboard's slot maths", () => {
		const now = manila(6, 30);
		const next = nextFeedingAt({
			scheduleStart: at(6),
			scheduleEnd: at(16),
			feedsPerDay: 4,
			now,
		});

		// 6:00 → 16:00 with four meals is 9:20, the same slot the strip shows.
		expect(farmParts(next)).toEqual({ day: 27, hour: 9, minute: 20 });
	});
});
