import { describe, expect, it, vi } from "vitest";
import { formatDateTimeLocal } from "../date-local";

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
