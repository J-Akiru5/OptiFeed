import { DIAG_BYTES_MAX, DIAG_KEYS_MAX, DIAG_STRING_MAX, sanitizeDiag } from "@/lib/device-diag";
import { describe, expect, it } from "vitest";

/**
 * Diagnostics sanitizer tests (issue #454): the heartbeat's diag object is
 * display-only evidence, so ingest must cap its shape rather than trust it.
 */
describe("sanitizeDiag", () => {
	it("passes through a well-formed flat object", () => {
		expect(
			sanitizeDiag({ sd_ok: true, heap: 45632, day_warnings: 3, reset_reason: "poweron" }),
		).toEqual({ sd_ok: true, heap: 45632, day_warnings: 3, reset_reason: "poweron" });
	});

	it("returns null for absent, scalar and array payloads", () => {
		expect(sanitizeDiag(undefined)).toBeNull();
		expect(sanitizeDiag(null)).toBeNull();
		expect(sanitizeDiag("oxygen drop")).toBeNull();
		expect(sanitizeDiag([1, 2, 3])).toBeNull();
	});

	it("truncates long string values instead of trusting them", () => {
		const result = sanitizeDiag({ note: "x".repeat(500) });
		expect(result?.note).toHaveLength(120);
	});

	it("drops non-finite numbers and replaces non-primitive values", () => {
		const result = sanitizeDiag({ heap: Number.NaN, nested: { deeper: 1 }, flag: true });
		expect(result).toEqual({ nested: "[object]", flag: true });
	});

	it("caps arrays and nulls out empties", () => {
		expect(sanitizeDiag({ vals: Array.from({ length: 30 }, () => 1) })).toEqual({
			vals: Array.from({ length: 8 }, () => 1),
		});
		expect(sanitizeDiag({ vals: [] })).toBeNull();
	});

	it("caps the key count", () => {
		const big: Record<string, number> = {};
		for (let i = 0; i < 100; i++) big[`k${i}`] = i;
		const result = sanitizeDiag(big);
		expect(Object.keys(result ?? {}).length).toBe(DIAG_KEYS_MAX);
	});

	it("drops an oversized object instead of storing it", () => {
		const huge: Record<string, string> = {};
		for (let i = 0; i < 24; i++) huge[`k${i}`] = "x".repeat(DIAG_STRING_MAX);
		expect(sanitizeDiag(huge)).toBeNull();
	});

	it("keeps the sanitised object under the byte cap", () => {
		const result = sanitizeDiag({ a: "y".repeat(120), b: "z".repeat(120) });
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(DIAG_BYTES_MAX);
	});
});
