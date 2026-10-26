import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARDWARE_RATING, maxPowerW } from "@/lib/constants/hardware-rating";
import { describe, expect, it } from "vitest";

describe("hardware rating", () => {
	it("holds the manuscript values (12 V DC, 5 A)", () => {
		expect(HARDWARE_RATING).toEqual({ inputVoltage: 12, supplyType: "DC", maxCurrentA: 5 });
	});

	it("derives max power as V x A", () => {
		expect(maxPowerW()).toBe(60);
		expect(maxPowerW({ inputVoltage: 24, maxCurrentA: 2.5 })).toBe(60);
	});

	it("keeps the verify-on-hardware warning next to the values", () => {
		const source = readFileSync(join(__dirname, "../constants/hardware-rating.ts"), "utf8");
		expect(source).toContain("TODO(verify-on-hardware)");
	});
});
