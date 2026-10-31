import { describe, expect, it } from "vitest";
import {
	EXPORT_LABELS,
	buildFilename,
	escapeFormulaInjection,
	parseCsvString,
	toCsvString,
} from "../csv";

describe("toCsvString", () => {
	it("returns empty string for empty array", () => {
		expect(toCsvString([])).toBe("");
	});

	it("converts rows to CSV string", () => {
		const csv = toCsvString([{ name: "Alice", age: 30 }]);
		expect(csv).toContain("name,age");
		expect(csv).toContain("Alice,30");
	});

	it("handles multiple rows", () => {
		const csv = toCsvString([
			{ a: 1, b: 2 },
			{ a: 3, b: 4 },
		]);
		const lines = csv.split("\n");
		expect(lines).toHaveLength(3); // header + 2 rows
	});

	it.each(["=1+1", "+SUM(A1)", "-cmd/evil", "@import", "\tjd", "\rjd"])(
		"escapes formula-like value %s (I-107)",
		(value) => {
			const csv = toCsvString([{ v: value }]);
			expect(csv).toContain(`'${value}`);
		},
	);

	it("does not escape harmless text", () => {
		const csv = toCsvString([{ v: "total weight 5kg" }]);
		expect(csv).toContain("total weight 5kg");
	});
});

describe("escapeFormulaInjection", () => {
	it("prefixes a leading apostrophe for formula and control prefixes", () => {
		expect(escapeFormulaInjection("=cmd")).toBe("'=cmd");
		expect(escapeFormulaInjection("-3")).toBe("'-3");
		expect(escapeFormulaInjection("hello")).toBe("hello");
	});
});

describe("parseCsvString", () => {
	it("parses valid CSV", () => {
		const csv = "name,age\nAlice,30\nBob,25";
		const result = parseCsvString(csv);
		expect(result.data).toHaveLength(2);
		expect(result.errors).toHaveLength(0);
	});

	it("skips empty lines", () => {
		const csv = "name,age\nAlice,30\n\nBob,25\n";
		const result = parseCsvString(csv);
		expect(result.data).toHaveLength(2);
	});

	it("filters rows with unexpected types", () => {
		const csv = "name,age\nAlice,30\n,invalid";
		const result = parseCsvString(csv);
		// Empty string "" is still a string, so the row passes the type filter
		expect(result.data).toHaveLength(2);
	});

	it("skips leading # note lines from the downloadable template", () => {
		const csv = "# Notes: sampleWeightKg is required\n# sampleCount must be a whole number\nsampleWeightKg,sampleCount\n10,5";
		const result = parseCsvString(csv);
		expect(result.data).toEqual([{ sampleWeightKg: "10", sampleCount: "5" }]);
		expect(result.errors).toHaveLength(0);
	});

	it("does not treat a # line inside the data as a comment", () => {
		const csv = "eventType,message\n#ping,hello";
		const result = parseCsvString(csv);
		expect(result.data).toHaveLength(1);
	});
});

describe("buildFilename", () => {
	it("builds filename with type and date", () => {
		const date = new Date("2025-07-04T12:00:00Z");
		expect(buildFilename("feed_events", date)).toBe("optifeed_feed_events_2025-07-04.csv");
	});

	it("handles all exportable types", () => {
		const types = Object.keys(EXPORT_LABELS) as Array<keyof typeof EXPORT_LABELS>;
		for (const type of types) {
			const filename = buildFilename(type, new Date("2025-01-01T00:00:00Z"));
			expect(filename).toContain(type);
		}
	});
});

describe("EXPORT_LABELS", () => {
	it("has labels for all 8 types including the feeding schedule", () => {
		expect(Object.keys(EXPORT_LABELS)).toHaveLength(8);
		expect(EXPORT_LABELS.feeding_schedule).toBe("Feeding Schedule");
	});
});
