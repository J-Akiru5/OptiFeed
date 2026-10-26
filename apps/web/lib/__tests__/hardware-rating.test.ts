import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARDWARE_RATING, RATED_LOADS, maxPower, powerUnit } from "@/lib/constants/hardware-rating";
import { describe, expect, it } from "vitest";

describe("hardware rating", () => {
	it("is 220 V AC at 60 Hz, as read from the blower and gear-motor nameplates", () => {
		expect(HARDWARE_RATING.inputVoltage).toBe(220);
		expect(HARDWARE_RATING.supplyType).toBe("AC");
		expect(HARDWARE_RATING.frequencyHz).toBe(60);
	});

	it("rounds the summed load current up to the next 0.1 A", () => {
		const sum = RATED_LOADS.reduce((total, load) => total + load.currentA, 0);
		// Blower 1.0 A (nameplate) + gear motor and speed controller 0.117 A
		// + electronics 0.036 A (both estimated).
		expect(sum).toBeCloseTo(1.1538, 4);
		expect(HARDWARE_RATING.maxCurrentA).toBe(1.2);
		expect(HARDWARE_RATING.maxCurrentA).toBeGreaterThanOrEqual(sum);
		expect(HARDWARE_RATING.maxCurrentA - sum).toBeLessThan(0.1);
	});

	it("records where every counted current comes from", () => {
		expect(RATED_LOADS.map((load) => load.id)).toEqual(["blower", "gear-motor", "electronics"]);
		for (const load of RATED_LOADS) expect(load.basis.length).toBeGreaterThan(0);
	});

	it("derives max power as V x A, in VA for AC and W for DC", () => {
		expect(maxPower()).toBeCloseTo(264, 6);
		expect(powerUnit()).toBe("VA");
		expect(powerUnit({ supplyType: "DC" })).toBe("W");
		expect(maxPower({ inputVoltage: 12, maxCurrentA: 5 })).toBe(60);
	});

	it("keeps the verify-on-hardware warning next to the values", () => {
		const source = readFileSync(join(__dirname, "../constants/hardware-rating.ts"), "utf8");
		expect(source).toContain("TODO(verify-on-hardware)");
	});
});
