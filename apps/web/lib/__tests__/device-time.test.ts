import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/device-time";
import { describe, expect, it } from "vitest";

describe("device time conversion", () => {
	it("formats an instant as local wall time for datetime-local", () => {
		const local = new Date(2026, 9, 25, 16, 25, 0, 0);
		expect(toLocalDateTimeInput(local)).toBe("2026-10-25T16:25");
	});

	it("converts a local input value to the same instant in UTC", () => {
		const iso = localDateTimeToIso("2026-10-25T16:25");
		expect(iso).not.toBeNull();
		expect(new Date(iso as string).getTime()).toBe(new Date(2026, 9, 25, 16, 25, 0, 0).getTime());
	});

	it("round-trips an instant through the input representation", () => {
		const original = new Date(2026, 0, 2, 9, 7, 0, 0);
		const value = toLocalDateTimeInput(original);
		expect(new Date(localDateTimeToIso(value) as string).getTime()).toBe(original.getTime());
	});

	it("rejects an empty or invalid value", () => {
		expect(localDateTimeToIso("")).toBeNull();
		expect(localDateTimeToIso("not-a-date")).toBeNull();
	});
});
