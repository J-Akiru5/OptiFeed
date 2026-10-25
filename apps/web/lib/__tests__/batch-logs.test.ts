import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { MAX_BATCH_LABEL_LENGTH, parseBatchFilter } from "../batch-logs";

describe("parseBatchFilter", () => {
	it("uses the unlabeled flag for the No Batch group", () => {
		expect(parseBatchFilter(undefined, "1")).toEqual({ kind: "unlabeled" });
	});

	it("prefers the unlabeled flag when both selectors are present", () => {
		expect(parseBatchFilter("Batch A", "1")).toEqual({ kind: "unlabeled" });
	});

	it("trims a named batch label", () => {
		expect(parseBatchFilter("  Batch A  ", undefined)).toEqual({
			kind: "label",
			label: "Batch A",
		});
	});

	it("rejects a missing or blank label", () => {
		expect(parseBatchFilter(undefined, undefined)).toBeNull();
		expect(parseBatchFilter("   ", undefined)).toBeNull();
	});

	it("rejects a label longer than the database limit", () => {
		expect(parseBatchFilter("x".repeat(MAX_BATCH_LABEL_LENGTH + 1), undefined)).toBeNull();
	});

	it("accepts a label at the database limit", () => {
		const label = "x".repeat(MAX_BATCH_LABEL_LENGTH);
		expect(parseBatchFilter(label, undefined)).toEqual({ kind: "label", label });
	});
});
