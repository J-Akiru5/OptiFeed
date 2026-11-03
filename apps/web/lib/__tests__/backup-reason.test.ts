import { describe, expect, it } from "vitest";

import {
	hasControlCharacters,
	readOptionalBackupReason,
	readRequiredBackupReason,
} from "@/lib/backup/reason";

/**
 * A reason is written into the dump's `--` header (#671), so a control
 * character has to be rejected rather than trimmed: a newline would end the
 * comment and run the rest as SQL on restore.
 */

describe("hasControlCharacters", () => {
	it("flags newlines, carriage returns and NUL", () => {
		expect(hasControlCharacters("a\nb")).toBe(true);
		expect(hasControlCharacters("a\rb")).toBe(true);
		expect(hasControlCharacters("a\u0000b")).toBe(true);
	});

	it("allows ordinary punctuation and non-ASCII text", () => {
		expect(hasControlCharacters("Rotate the key — after the incident.")).toBe(false);
		expect(hasControlCharacters("Nag-rotate ng key")).toBe(false);
	});
});

describe("readOptionalBackupReason", () => {
	it("treats an absent or blank reason as no reason", () => {
		expect(readOptionalBackupReason(undefined)).toEqual({ ok: true, value: null });
		expect(readOptionalBackupReason(null)).toEqual({ ok: true, value: null });
		expect(readOptionalBackupReason("   ")).toEqual({ ok: true, value: null });
	});

	it("returns a normal reason trimmed", () => {
		expect(readOptionalBackupReason("  Tenant export  ")).toEqual({
			ok: true,
			value: "Tenant export",
		});
	});

	it("rejects a newline instead of trimming it", () => {
		expect(readOptionalBackupReason('ok\nDROP TABLE "User"; --')).toEqual({ ok: false });
	});

	it("rejects non-strings and over-long values", () => {
		expect(readOptionalBackupReason(42)).toEqual({ ok: false });
		expect(readOptionalBackupReason("x".repeat(501))).toEqual({ ok: false });
	});
});

describe("readRequiredBackupReason", () => {
	it("requires 10 to 500 single-line characters", () => {
		expect(readRequiredBackupReason("short")).toBeNull();
		expect(readRequiredBackupReason("0123456789")).toBe("0123456789");
		expect(readRequiredBackupReason("x".repeat(501))).toBeNull();
	});

	it("rejects a newline at any length", () => {
		expect(readRequiredBackupReason('0123456789\nDROP TABLE "User"; --')).toBeNull();
	});
});
