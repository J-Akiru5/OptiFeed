import { scheduleInputSchema } from "@/lib/limits";
import { describe, expect, it } from "vitest";

/**
 * #763 — the schema accepted a zero-length window with several feeds, which the
 * preview rendered as N identical slots and the device would dispense at once.
 */
const BASE = { feedingRatePct: 3 };

describe("scheduleInputSchema feeding window (#763)", () => {
	it("rejects start === end when there is more than one feed", () => {
		const result = scheduleInputSchema.safeParse({
			...BASE,
			scheduleStart: "06:00",
			scheduleEnd: "06:00",
			feedsPerDay: 2,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["scheduleEnd"]);
			expect(result.error.issues[0]?.message).toContain("non-zero feeding window");
		}
	});

	it("accepts a single feed at one time", () => {
		expect(
			scheduleInputSchema.safeParse({
				...BASE,
				scheduleStart: "06:00",
				scheduleEnd: "06:00",
				feedsPerDay: 1,
			}).success,
		).toBe(true);
	});

	it("still accepts a window that runs past midnight", () => {
		expect(
			scheduleInputSchema.safeParse({
				...BASE,
				scheduleStart: "22:00",
				scheduleEnd: "04:00",
				feedsPerDay: 4,
			}).success,
		).toBe(true);
	});
});
