import { describe, expect, it, vi } from "vitest";
import {
	farmWallClock,
	farmWallClockToInstant,
	formatDateTimeLocal,
	formatFarmDateTime,
	formatWallClockTime,
	zoneOffsetMs,
} from "../date-local";

describe("formatDateTimeLocal", () => {
	const mockTranslator = (key: string): string => {
		const map: Record<string, string> = {
			"days.Mon": "Mon",
			"days.Tue": "Tue",
			"days.Wed": "Wed",
			"days.Thu": "Thu",
			"days.Fri": "Fri",
			"days.Sat": "Sat",
			"days.Sun": "Sun",
			"months.Jan": "Jan",
			"months.Feb": "Feb",
			"months.Mar": "Mar",
			"months.Apr": "Apr",
			"months.May": "May",
			"months.Jun": "Jun",
			"months.Jul": "Jul",
			"months.Aug": "Aug",
			"months.Sep": "Sep",
			"months.Oct": "Oct",
			"months.Nov": "Nov",
			"months.Dec": "Dec",
			am: "AM",
			pm: "PM",
		};
		return map[key] ?? key;
	};

	it("formats a date correctly", () => {
		const date = new Date("2025-07-08T16:19:00");
		const result = formatDateTimeLocal(date, mockTranslator);
		expect(result.time).toBe("4:19 PM");
		expect(result.date).toBe("Jul 8");
		expect(result.fullDate).toContain("Jul 8");
		expect(result.full).toContain("Jul 8 • 4:19 PM");
	});

	it("formats midnight as 12 AM", () => {
		const date = new Date("2025-01-01T00:00:00");
		const result = formatDateTimeLocal(date, mockTranslator);
		expect(result.time).toBe("12:00 AM");
	});

	it("formats noon as 12 PM", () => {
		const date = new Date("2025-01-01T12:00:00");
		const result = formatDateTimeLocal(date, mockTranslator);
		expect(result.time).toBe("12:00 PM");
	});

	it("pads single-digit minutes", () => {
		const date = new Date("2025-01-01T09:05:00");
		const result = formatDateTimeLocal(date, mockTranslator);
		expect(result.time).toBe("9:05 AM");
	});

	it("passes correct day and month keys to translator", () => {
		const translator = vi.fn(mockTranslator);
		const date = new Date("2025-03-15T10:30:00");
		formatDateTimeLocal(date, translator);
		expect(translator).toHaveBeenCalledWith("days.Sat");
		expect(translator).toHaveBeenCalledWith("months.Mar");
	});
});

describe("formatFarmDateTime", () => {
	const mockTranslator = (key: string): string => {
		const map: Record<string, string> = {
			"days.Mon": "Mon",
			"days.Tue": "Tue",
			"days.Wed": "Wed",
			"days.Thu": "Thu",
			"days.Fri": "Fri",
			"days.Sat": "Sat",
			"days.Sun": "Sun",
			"months.Oct": "Oct",
			am: "AM",
			pm: "PM",
		};
		return map[key] ?? key;
	};

	it("renders a UTC instant in Asia/Manila, not the runtime timezone", () => {
		// 18:00 UTC on Oct 27 is 02:00 on Oct 28 in Manila.
		const result = formatFarmDateTime(new Date("2026-10-27T18:00:00.000Z"), mockTranslator);
		expect(result.time).toBe("2:00 AM");
		expect(result.date).toBe("Oct 28");
		expect(result.fullDate).toBe("Wed, Oct 28");
	});

	it("formats an evening instant in Manila", () => {
		// 13:30 UTC is 21:30 in Manila on the same day.
		const result = formatFarmDateTime(new Date("2026-10-27T13:30:00.000Z"), mockTranslator);
		expect(result.time).toBe("9:30 PM");
		expect(result.fullDate).toContain("Oct 27");
	});

	it("hides no farm data behind the runtime locale", () => {
		const translator = vi.fn(mockTranslator);
		formatFarmDateTime(new Date("2026-10-27T18:00:00.000Z"), translator);
		expect(translator).toHaveBeenCalledWith("days.Wed");
		expect(translator).toHaveBeenCalledWith("months.Oct");
	});

	it("does not throw on an invalid date", () => {
		// A corrupt timestamp from a device must degrade to a label, not crash
		// the whole page render.
		expect(() => formatFarmDateTime(new Date(Number.NaN), mockTranslator)).not.toThrow();
	});
});

describe("formatWallClockTime", () => {
	const mockTranslator = (key: string): string => (key === "pm" ? "PM" : "AM");

	it("formats farm wall clock times without an instant", () => {
		expect(formatWallClockTime(6, 0, mockTranslator)).toBe("6:00 AM");
		expect(formatWallClockTime(16, 5, mockTranslator)).toBe("4:05 PM");
		expect(formatWallClockTime(0, 30, mockTranslator)).toBe("12:30 AM");
		expect(formatWallClockTime(12, 0, mockTranslator)).toBe("12:00 PM");
	});

	it("never derives an instant from the runtime timezone", () => {
		// 08:00 Manila is 00:00 UTC, not 08:00 UTC.
		const instant = farmWallClockToInstant({
			year: 2026,
			month: 10,
			day: 27,
			hour: 8,
			minute: 30,
		});
		expect(instant.toISOString()).toBe("2026-10-27T00:30:00.000Z");
		expect(farmWallClock(instant)).toMatchObject({ day: 27, hour: 8, minute: 30 });
	});

	it("is the inverse of farmWallClock across a day boundary", () => {
		const instant = new Date("2026-10-27T18:00:00.000Z"); // 02:00 Oct 28 Manila
		const clock = farmWallClock(instant);
		expect(farmWallClockToInstant(clock).toISOString()).toBe(instant.toISOString());
	});

	it("reports the farm zone offset in milliseconds", () => {
		expect(zoneOffsetMs(new Date("2026-10-27T00:00:00.000Z"))).toBe(8 * 60 * 60 * 1000);
	});
});
