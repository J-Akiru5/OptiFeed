import { describe, expect, it } from "vitest";

import {
	CONTACT_EMAIL_INVALID,
	CONTACT_EMAIL_POND,
	isContactEmailConflict,
	normalizeContactEmail,
	parseResetIdentifier,
} from "@/lib/contact-email";

describe("normalizeContactEmail", () => {
	it("trims and lower-cases a real mailbox", () => {
		expect(normalizeContactEmail("  Farmer@Example.COM ")).toEqual({
			ok: true,
			value: "farmer@example.com",
		});
	});

	it("treats blank, null and undefined as clearing the address", () => {
		expect(normalizeContactEmail("")).toEqual({ ok: true, value: null });
		expect(normalizeContactEmail("   ")).toEqual({ ok: true, value: null });
		expect(normalizeContactEmail(null)).toEqual({ ok: true, value: null });
		expect(normalizeContactEmail(undefined)).toEqual({ ok: true, value: null });
	});

	it("rejects typos and shapes that are not a single mailbox", () => {
		for (const bad of [
			"no-at-sign",
			"farmer@",
			"@example.com",
			"farmer@example",
			"two words@example.com",
			// A recipient list would deliver the reset link to the second address.
			"farmer@example.com,attacker@evil.example",
			"farmer@example.com;attacker@evil.example",
			`${"a".repeat(250)}@example.com`,
		]) {
			expect(normalizeContactEmail(bad), bad).toEqual({ ok: false, error: CONTACT_EMAIL_INVALID });
		}
	});

	it("rejects a non-string value", () => {
		expect(normalizeContactEmail(42)).toEqual({ ok: false, error: CONTACT_EMAIL_INVALID });
		expect(normalizeContactEmail({})).toEqual({ ok: false, error: CONTACT_EMAIL_INVALID });
	});

	it("rejects the synthetic pond login address, which can never receive mail", () => {
		expect(normalizeContactEmail("demo-farmer-1@pond.optifeed.local")).toEqual({
			ok: false,
			error: CONTACT_EMAIL_POND,
		});
		expect(normalizeContactEmail("Demo-Farmer-1@POND.optifeed.local")).toEqual({
			ok: false,
			error: CONTACT_EMAIL_POND,
		});
	});
});

describe("parseResetIdentifier", () => {
	it("reads a bare value as a farm ID", () => {
		expect(parseResetIdentifier("  Demo-Farmer-1 ")).toEqual({
			kind: "farmId",
			value: "demo-farmer-1",
		});
	});

	it("reads an address with an @ as a contact email", () => {
		expect(parseResetIdentifier(" Farmer@Example.com ")).toEqual({
			kind: "email",
			value: "farmer@example.com",
		});
	});

	it("reads the pond login address as the farm ID inside it", () => {
		expect(parseResetIdentifier("demo-farmer-1@pond.optifeed.local")).toEqual({
			kind: "farmId",
			value: "demo-farmer-1",
		});
	});

	it("rejects empty, over-long and non-string input", () => {
		expect(parseResetIdentifier("")).toBeNull();
		expect(parseResetIdentifier("   ")).toBeNull();
		expect(parseResetIdentifier(`${"a".repeat(255)}`)).toBeNull();
		expect(parseResetIdentifier(undefined)).toBeNull();
		expect(parseResetIdentifier(7)).toBeNull();
	});

	it("rejects a pond address with no local part", () => {
		expect(parseResetIdentifier("@pond.optifeed.local")).toBeNull();
	});
});

describe("isContactEmailConflict", () => {
	it("reads a Prisma unique violation as a conflict", () => {
		expect(isContactEmailConflict(Object.assign(new Error("dup"), { code: "P2002" }))).toBe(true);
	});

	it("does not mistake other failures for one", () => {
		expect(isContactEmailConflict(Object.assign(new Error("x"), { code: "P2025" }))).toBe(false);
		expect(isContactEmailConflict(new Error("db down"))).toBe(false);
		expect(isContactEmailConflict(null)).toBe(false);
		expect(isContactEmailConflict("P2002")).toBe(false);
	});
});
