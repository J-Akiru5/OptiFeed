import { nextFeedingAt } from "@/lib/schedule/next-feeding";
import { describe, expect, it } from "vitest";

/** `@db.Time` values arrive as a Date whose UTC hours are the configured hour. */
function at(hour: number, minute = 0): Date {
	return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

describe("nextFeedingAt", () => {
	it("returns the next slot later today", () => {
		const now = new Date(2026, 9, 27, 11, 0, 0);
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now,
		});

		expect(next.getDate()).toBe(27);
		expect(next.getHours()).toBe(12);
		expect(next.getMinutes()).toBe(0);
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});

	it("rolls over to tomorrow's first slot after the last one", () => {
		const now = new Date(2026, 9, 27, 17, 30, 0);
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(16),
			feedsPerDay: 3,
			now,
		});

		expect(next.getDate()).toBe(28);
		expect(next.getHours()).toBe(8);
	});

	it("uses the start hour when there is a single meal", () => {
		const now = new Date(2026, 9, 27, 20, 0, 0);
		const next = nextFeedingAt({
			scheduleStart: at(6),
			scheduleEnd: at(18),
			feedsPerDay: 1,
			now,
		});

		expect(next.getDate()).toBe(28);
		expect(next.getHours()).toBe(6);
	});

	it("never divides by zero on a bad schedule", () => {
		const now = new Date(2026, 9, 27, 7, 0, 0);
		const next = nextFeedingAt({
			scheduleStart: at(8),
			scheduleEnd: at(8),
			feedsPerDay: 0,
			now,
		});

		expect(next.getHours()).toBe(8);
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});
});
