import {
	firstVerifiedTotpFactor,
	hasVerifiedFactor,
	isMfaChallengePending,
	normalizeTotpCode,
} from "@/lib/auth/mfa-policy";
import { describe, expect, it } from "vitest";

/**
 * Pure MFA policy (#719).
 *
 * The security-relevant decision is "does this session still owe a code?".
 * Getting it wrong in either direction is a defect: a false negative lets an
 * AAL1 session into the platform console, a false positive locks an admin out
 * of an account with no factor.
 */

const TOTP_VERIFIED = {
	id: "factor-1",
	factor_type: "totp",
	status: "verified",
};
const TOTP_UNVERIFIED = {
	id: "factor-2",
	factor_type: "totp",
	status: "unverified",
};
const PHONE_VERIFIED = {
	id: "factor-3",
	factor_type: "phone",
	status: "verified",
};

describe("isMfaChallengePending", () => {
	it("requires a code for a password session when a verified factor exists", () => {
		expect(isMfaChallengePending({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
	});

	it("does not challenge a session that already reached aal2", () => {
		expect(isMfaChallengePending({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
	});

	it("never challenges an account with no verified factor (optional rollout)", () => {
		expect(isMfaChallengePending({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
	});

	it("treats no session as nothing to challenge", () => {
		expect(isMfaChallengePending(null)).toBe(false);
		expect(isMfaChallengePending({ currentLevel: null, nextLevel: null })).toBe(false);
	});
});

describe("hasVerifiedFactor", () => {
	it("is true only for a verified factor", () => {
		expect(hasVerifiedFactor([TOTP_VERIFIED])).toBe(true);
		expect(hasVerifiedFactor([TOTP_UNVERIFIED])).toBe(false);
		expect(hasVerifiedFactor([])).toBe(false);
		expect(hasVerifiedFactor(undefined)).toBe(false);
	});
});

describe("firstVerifiedTotpFactor", () => {
	it("selects a verified TOTP factor", () => {
		expect(firstVerifiedTotpFactor([TOTP_UNVERIFIED, TOTP_VERIFIED])?.id).toBe("factor-1");
	});

	it("does not silently treat another factor type as nothing to do", () => {
		expect(firstVerifiedTotpFactor([PHONE_VERIFIED])).toBeNull();
	});
});

describe("normalizeTotpCode", () => {
	it("accepts six digits with surrounding or grouped whitespace", () => {
		expect(normalizeTotpCode("123456")).toBe("123456");
		expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
	});

	it("rejects anything that is not six digits", () => {
		expect(normalizeTotpCode("12345")).toBeNull();
		expect(normalizeTotpCode("1234567")).toBeNull();
		expect(normalizeTotpCode("12a456")).toBeNull();
		expect(normalizeTotpCode("")).toBeNull();
		expect(normalizeTotpCode(undefined)).toBeNull();
	});
});
