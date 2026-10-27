import { MAX_OCCURRENCES, expandOccurrences } from "@/lib/calendar/recurrence";
import { addDays } from "@/lib/crop-cycle/dates";
import { describe, expect, it } from "vitest";

function starts(input: Parameters<typeof expandOccurrences>[0]): string[] {
	return expandOccurrences(input).occurrences.map((occurrence) => occurrence.start);
}

describe("expandOccurrences", () => {
	it("returns a single occurrence for a non-recurring item in range", () => {
		const result = expandOccurrences({
			start: "2026-10-27",
			allDay: true,
			window: { from: "2026-10-01", to: "2026-10-31" },
		});

		expect(result.truncated).toBe(false);
		expect(result.occurrences).toHaveLength(1);
		expect(result.occurrences[0]).toMatchObject({
			start: "2026-10-27",
			end: null,
			occurrenceKey: "2026-10-27T00:00:00.000Z",
		});
	});

	it("omits a one-off item outside the window", () => {
		expect(
			starts({
				start: "2026-09-01",
				allDay: true,
				window: { from: "2026-10-01", to: "2026-10-31" },
			}),
		).toEqual([]);
	});

	it("expands daily with an interval", () => {
		expect(
			starts({
				start: "2026-10-01",
				allDay: true,
				recurrence: { freq: "DAILY", interval: 2 },
				window: { from: "2026-10-01", to: "2026-10-07" },
			}),
		).toEqual(["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07"]);
	});

	it("expands weekly with an interval", () => {
		expect(
			starts({
				start: "2026-10-01",
				allDay: true,
				recurrence: { freq: "WEEKLY", interval: 2 },
				window: { from: "2026-10-01", to: "2026-10-31" },
			}),
		).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
	});

	it("keeps month ends instead of drifting from the previous occurrence", () => {
		expect(
			starts({
				start: "2026-01-31",
				allDay: true,
				recurrence: { freq: "MONTHLY", interval: 1 },
				window: { from: "2026-01-01", to: "2026-06-30" },
			}),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
	});

	it("honours a monthly interval and an inclusive until date", () => {
		expect(
			starts({
				start: "2026-01-31",
				allDay: true,
				recurrence: { freq: "MONTHLY", interval: 2, until: "2026-05-31" },
				window: { from: "2026-01-01", to: "2026-12-31" },
			}),
		).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
	});

	it("starts the window from a series that began earlier", () => {
		expect(
			starts({
				start: "2026-01-05",
				allDay: true,
				recurrence: { freq: "WEEKLY", interval: 1 },
				window: { from: "2026-10-01", to: "2026-10-20" },
			}),
		).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
	});

	it("preserves a timed duration", () => {
		const result = expandOccurrences({
			start: "2026-10-27T09:00",
			end: "2026-10-27T10:30",
			allDay: false,
			recurrence: { freq: "DAILY", interval: 1 },
			window: { from: "2026-10-27", to: "2026-10-28" },
		});

		expect(result.occurrences.map((occurrence) => [occurrence.start, occurrence.end])).toEqual([
			["2026-10-27T09:00", "2026-10-27T10:30"],
			["2026-10-28T09:00", "2026-10-28T10:30"],
		]);
	});

	it("preserves a multi-day all-day span", () => {
		const result = expandOccurrences({
			start: "2026-10-27",
			end: "2026-10-29",
			allDay: true,
			recurrence: { freq: "WEEKLY", interval: 1 },
			window: { from: "2026-10-27", to: "2026-11-05" },
		});

		expect(result.occurrences.map((occurrence) => [occurrence.start, occurrence.end])).toEqual([
			["2026-10-27", "2026-10-29"],
			["2026-11-03", "2026-11-05"],
		]);
	});

	it("caps a dense series at 500 occurrences", () => {
		const result = expandOccurrences({
			start: "2026-01-01",
			allDay: true,
			recurrence: { freq: "DAILY", interval: 1 },
			window: { from: "2026-01-01", to: "2028-12-31" },
		});

		expect(result.truncated).toBe(true);
		expect(result.occurrences).toHaveLength(MAX_OCCURRENCES);
		expect(result.occurrences.at(-1)?.start).toBe(addDays("2026-01-01", 499));
	});

	it("ignores an invalid interval and an invalid until value safely", () => {
		expect(
			starts({
				start: "2026-10-01",
				allDay: true,
				recurrence: { freq: "DAILY", interval: 0, until: "not-a-date" },
				window: { from: "2026-10-01", to: "2026-10-03" },
			}),
		).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
	});
});
