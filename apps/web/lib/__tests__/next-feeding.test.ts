import { farmWallClock } from "@/lib/date-local";
import { nextFeedingAt } from "@/lib/schedule/next-feeding";
import { describe, expect, it } from "vitest";

/** `@db.Time` values arrive as a Date whose UTC hours are the configured hour. */
function at(hour: number, minute = 0): Date {
	return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

describe("nextFeedingAt", () => {
	it("returns the next slot later today in the farm's wall clock", () => {
		// 03:00 UTC = 11:00 in Manila on Oct 27.
		const now = new Date("2026-10-27T03:00:00.000Z");
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now,
		});

		// 8/12/16 → the next slot is 12:00 Manila (04:00 UTC).
		expect(next.toISOString()).toBe("2026-10-27T04:00:00.000Z");
		expect(farmWallClock(next)).toMatchObject({ day: 27, hour: 12, minute: 0 });
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});

	it("rolls over to tomorrow's first slot after the last one", () => {
		// 17:30 Manila on Oct 27.
		const now = new Date("2026-10-27T09:30:00.000Z");
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now,
		});

		expect(next.toISOString()).toBe("2026-10-28T00:00:00.000Z");
		expect(farmWallClock(next)).toMatchObject({ day: 28, hour: 8, minute: 0 });
	});

	it("uses the start hour when there is a single meal", () => {
		// 20:00 Manila on Oct 27.
		const now = new Date("2026-10-27T12:00:00.000Z");
		const next = nextFeedingAt({
			scheduleStart: at(6),
			scheduleEnd: at(18),
			feedsPerDay: 1,
			now,
		});

		expect(next.toISOString()).toBe("2026-10-27T22:00:00.000Z");
		expect(farmWallClock(next)).toMatchObject({ day: 28, hour: 6, minute: 0 });
	});

	it("never divides by zero on a bad schedule", () => {
		const now = new Date("2026-10-27T07:00:00.000Z");
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(8),
			feedsPerDay: 0,
			now,
		});

		expect(farmWallClock(next)).toMatchObject({ hour: 8 });
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});

	it("renders the same farm time regardless of the host timezone", () => {
		// 07:00 UTC = 15:00 Manila. The old machine-local `setHours` produced
		// 16:00 UTC (midnight in Manila) whenever the server ran in UTC.
		const next = nextFeedingAt({
			scheduleStart: at(16),
			scheduleEnd: at(20),
			feedsPerDay: 1,
			now: new Date("2026-10-27T07:00:00.000Z"),
		});

		expect(next.toISOString()).toBe("2026-10-27T08:00:00.000Z");
		expect(farmWallClock(next)).toMatchObject({ day: 27, hour: 16, minute: 0 });
	});
});
