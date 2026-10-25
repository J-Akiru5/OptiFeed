import {
	PASSWORD_MAX_BYTES,
	PASSWORD_MIN_LENGTH,
	getPasswordStrength,
	passwordChecks,
	passwordErrorMessage,
	validatePassword,
} from "@/lib/auth/password";
import { describe, expect, it } from "vitest";

describe("validatePassword", () => {
	it("accepts password123 as a temporary password", () => {
		expect(validatePassword("password123", "temporary")).toEqual({ ok: true });
	});

	it("rejects password123 as a permanent password", () => {
		expect(validatePassword("password123", "permanent")).toEqual({
			ok: false,
			code: "common",
		});
	});

	it("accepts an 8-character letter+number password", () => {
		expect(validatePassword("abcdefg1", "permanent")).toEqual({ ok: true });
	});

	it("rejects a password shorter than the minimum", () => {
		expect(validatePassword("abc123", "permanent")).toEqual({
			ok: false,
			code: "too_short",
		});
	});

	it("rejects a password without a letter", () => {
		expect(validatePassword("12345678", "permanent")).toEqual({
			ok: false,
			code: "missing_letter",
		});
	});

	it("rejects a password without a number", () => {
		expect(validatePassword("abcdefgh", "permanent")).toEqual({
			ok: false,
			code: "missing_number",
		});
	});

	it("rejects a password over the bcrypt byte limit", () => {
		const password = `a1${"x".repeat(PASSWORD_MAX_BYTES)}`;
		expect(validatePassword(password, "temporary")).toEqual({
			ok: false,
			code: "too_long",
		});
	});

	it("accepts Unicode letters", () => {
		expect(validatePassword("pässwörd1", "permanent")).toEqual({ ok: true });
	});

	it("rejects an empty password in both modes", () => {
		expect(validatePassword("", "temporary")).toEqual({ ok: false, code: "empty" });
		expect(validatePassword("", "permanent")).toEqual({ ok: false, code: "empty" });
	});
});

describe("getPasswordStrength", () => {
	it("marks password123 as weak", () => {
		expect(getPasswordStrength("password123")).toBe("weak");
	});

	it("marks an 8-character letter+number password as medium", () => {
		expect(getPasswordStrength("abcdefg1")).toBe("medium");
	});

	it("marks a 12+ character password with mixed case and a symbol as strong", () => {
		expect(getPasswordStrength("Abcdefgh1234!")).toBe("strong");
	});

	it("marks an invalid password as weak", () => {
		expect(getPasswordStrength("abc")).toBe("weak");
	});
});

describe("passwordChecks", () => {
	it("reports each requirement independently", () => {
		expect(passwordChecks("abcdefg1")).toEqual({
			minLength: true,
			letter: true,
			number: true,
			upper: false,
			symbol: false,
		});
		expect(passwordChecks("Abc!")).toEqual({
			minLength: false,
			letter: true,
			number: false,
			upper: true,
			symbol: true,
		});
	});
});

describe("passwordErrorMessage", () => {
	it("mentions the minimum length", () => {
		expect(passwordErrorMessage("too_short")).toContain(String(PASSWORD_MIN_LENGTH));
	});

	it("explains the common-password rejection", () => {
		expect(passwordErrorMessage("common")).toContain("common");
	});
});
