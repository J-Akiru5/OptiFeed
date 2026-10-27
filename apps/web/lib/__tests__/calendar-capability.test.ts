import { calendarCapability } from "@/lib/calendar/capability";
import { describe, expect, it } from "vitest";

/**
 * E25 follow-up: one capability state per role, derived from the same inputs
 * the server writes with. The UI badge and the disabled controls both consume
 * this function, so a permission change cannot leave the screen optimistic.
 */
describe("calendarCapability", () => {
	it("is read-only without write permission, even when ponds are listed", () => {
		expect(calendarCapability({ canManage: false, writablePondIds: ["p1"], pondCount: 3 })).toBe(
			"read",
		);
	});

	it("is edit when the caller can write every listed pond", () => {
		expect(
			calendarCapability({ canManage: true, writablePondIds: ["p1", "p2"], pondCount: 2 }),
		).toBe("edit");
	});

	it("is edit when the write scope is omitted (single-farm pages)", () => {
		expect(calendarCapability({ canManage: true, pondCount: 2 })).toBe("edit");
	});

	it("is own-farm when the caller can write only some of the visible ponds", () => {
		expect(calendarCapability({ canManage: true, writablePondIds: ["p1"], pondCount: 3 })).toBe(
			"own-farm",
		);
	});

	it("treats an empty writable list as own-farm, not edit", () => {
		expect(calendarCapability({ canManage: true, writablePondIds: [], pondCount: 2 })).toBe(
			"own-farm",
		);
	});
});
