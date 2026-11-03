import { validateScheduleWindow } from "@/lib/schedule/window";
import { describe, expect, it } from "vitest";

/**
 * The editor's window validation (#763). The server still owns the final
 * schedule guards; this helper keeps the preview and Save button from offering
 * a window the feeder cannot run.
 */
describe("validateScheduleWindow", () => {
	it("accepts a normal daytime window", () => {
		expect(validateScheduleWindow("06:00", "18:00", 4)).toBeNull();
	});

	it("accepts an overnight window", () => {
		expect(validateScheduleWindow("22:00", "06:00", 4)).toBeNull();
	});

	it("rejects a zero-length window when more than one feed is scheduled", () => {
		expect(validateScheduleWindow("06:00", "06:00", 2)).toBe("zeroLength");
		expect(validateScheduleWindow("06:00", "06:00", 24)).toBe("zeroLength");
	});

	it("allows the same clock time for a single daily feed", () => {
		expect(validateScheduleWindow("06:00", "06:00", 1)).toBeNull();
	});

	it("reports an unparseable start or end", () => {
		expect(validateScheduleWindow("", "18:00", 2)).toBe("invalidStart");
		expect(validateScheduleWindow("06:00", "", 2)).toBe("invalidEnd");
		expect(validateScheduleWindow("25:00", "18:00", 2)).toBe("invalidStart");
		expect(validateScheduleWindow("06:00", "18:60", 2)).toBe("invalidEnd");
	});
});
