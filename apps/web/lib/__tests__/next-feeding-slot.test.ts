import { describe, expect, it } from "vitest";
import { computeNextFeedingSlot } from "../schedule/next-feeding-slot";

/** A `@db.Time` value read back by Prisma: the wall clock sits in UTC. */
function time(hours: number, minutes = 0): Date {
	return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
}

/** An instant expressed as a Manila wall clock. */
function manila(hours: number, minutes = 0, day = 27): Date {
	return new Date(Date.UTC(2026, 9, day, hours - 8, minutes, 0, 0));
}

describe("computeNextFeedingSlot", () => {
	const daytime = { scheduleStart: time(6), scheduleEnd: time(16), feedsPerDay: 3 };

	it("returns the next slot later today", () => {
		const slot = computeNextFeedingSlot({ ...daytime, now: manila(7) });
		expect(slot).toEqual({ hours: 11, minutes: 0, dayOffset: 0 });
	});

	it("rolls over to tomorrow's start after the last feed", () => {
		const slot = computeNextFeedingSlot({ ...daytime, now: manila(17) });
		expect(slot).toEqual({ hours: 6, minutes: 0, dayOffset: 1 });
	});

	it("uses Manila time, not the server timezone", () => {
		// 22:30 in Manila is 14:30 UTC. A UTC comparison would still claim
		// today's 16:00 feed, which already happened six and a half hours ago.
		const slot = computeNextFeedingSlot({ ...daytime, now: manila(22, 30) });
		expect(slot).toEqual({ hours: 6, minutes: 0, dayOffset: 1 });
	});

	it("spaces feeds evenly across the window", () => {
		const slot = computeNextFeedingSlot({
			scheduleStart: time(6),
			scheduleEnd: time(16),
			feedsPerDay: 4,
			now: manila(6, 30),
		});
		expect(slot).toEqual({ hours: 9, minutes: 20, dayOffset: 0 });
	});

	it("handles a single daily feeding", () => {
		const slot = computeNextFeedingSlot({
			scheduleStart: time(8),
			scheduleEnd: time(8),
			feedsPerDay: 1,
			now: manila(9),
		});
		expect(slot).toEqual({ hours: 8, minutes: 0, dayOffset: 1 });
	});

	it("keeps the after-midnight tail of an overnight schedule", () => {
		// 22:00 → 04:00, three feeds at 22:00, 01:00 and 04:00. At 01:00 the
		// next feed is 04:00 today, not 22:00 tonight.
		const overnight = {
			scheduleStart: time(22),
			scheduleEnd: time(4),
			feedsPerDay: 3,
		};
		expect(computeNextFeedingSlot({ ...overnight, now: manila(1) })).toEqual({
			hours: 4,
			minutes: 0,
			dayOffset: 0,
		});
		expect(computeNextFeedingSlot({ ...overnight, now: manila(23) })).toEqual({
			hours: 1,
			minutes: 0,
			dayOffset: 1,
		});
	});

	it("clamps an invalid feeds-per-day instead of dividing by zero", () => {
		const slot = computeNextFeedingSlot({
			scheduleStart: time(6),
			scheduleEnd: time(16),
			feedsPerDay: 0,
			now: manila(7),
		});
		expect(slot).toEqual({ hours: 6, minutes: 0, dayOffset: 1 });
	});
});
