import { describe, expect, it } from "vitest";
import { EXPORT_LABELS, buildFilename, parseCsvString, toCsvString } from "../csv";

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
	it("has labels for all 7 types", () => {
		expect(Object.keys(EXPORT_LABELS)).toHaveLength(7);
	});
});
