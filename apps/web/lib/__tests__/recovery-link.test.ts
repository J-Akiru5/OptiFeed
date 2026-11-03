import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintPasswordResetProof } from "@/lib/auth/password-reset-proof";
import {
	buildRecoveryConfirmUrl,
	isRecoveryProof,
	parseRecoveryConfirmation,
	recoveryRedirectPath,
} from "@/lib/auth/recovery-link";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The proof module imports the Prisma singleton for persistence; minting is
// pure and these tests never touch the store.
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/i18n/routing", () => ({
	routing: { locales: ["en", "hil", "tl"], defaultLocale: "en" },
}));

/**
 * Recovery confirmation (#741).
 *
 * The emailed URL must land on this app's confirmation route with the SSR
 * `token_hash` flow, and the route must only ever emit a same-origin reset
 * redirect. The signed proof (#718) is carried separately; the confirmation
 * route establishes a session but never changes a password.
 */

const BASE = "https://app.example";
const webRoot = join(__dirname, "../..");
const previousSigningKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeAll(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterAll(() => {
	if (previousSigningKey === undefined) {
		Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
	} else {
		process.env.SUPABASE_SERVICE_ROLE_KEY = previousSigningKey;
	}
});

describe("buildRecoveryConfirmUrl", () => {
	it("points the email at the locale-aware confirmation route", () => {
		expect(
			buildRecoveryConfirmUrl({
				baseUrl: BASE,
				locale: "en",
				tokenHash: "hashed-recovery-token",
				resetToken: "proof.token",
			}),
		).toBe(
			"https://app.example/en/auth/confirm?token_hash=hashed-recovery-token&type=recovery&reset=proof.token",
		);
	});

	it("keeps the Supabase fallback destination locale-aware without a token hash", () => {
		expect(
			buildRecoveryConfirmUrl({ baseUrl: BASE, locale: "hil", resetToken: "proof.token" }),
		).toBe("https://app.example/hil/auth/confirm?reset=proof.token");
	});

	it("strips trailing slashes and falls back to the default locale", () => {
		expect(
			buildRecoveryConfirmUrl({
				baseUrl: "https://app.example///",
				locale: "xx-not-a-locale",
				tokenHash: "hashed",
			}),
		).toBe("https://app.example/en/auth/confirm?token_hash=hashed&type=recovery");
	});
});

describe("parseRecoveryConfirmation", () => {
	it("accepts the token_hash recovery flow this app mints", () => {
		const params = new URLSearchParams({
			token_hash: "hashed-recovery-token",
			type: "recovery",
		});

		expect(parseRecoveryConfirmation(params)).toEqual({
			action: "verify",
			tokenHash: "hashed-recovery-token",
		});
	});

	it("accepts a PKCE code as a fallback", () => {
		const params = new URLSearchParams({ code: "pkce-code-123" });

		expect(parseRecoveryConfirmation(params)).toEqual({
			action: "exchange",
			code: "pkce-code-123",
		});
	});

	it("rejects a malformed code", () => {
		expect(parseRecoveryConfirmation(new URLSearchParams({ code: "bad code!" }))).toEqual({
			action: "invalid",
			reason: "malformed",
		});
	});

	it("rejects a token for a flow other than recovery", () => {
		const params = new URLSearchParams({ token_hash: "hashed-recovery-token", type: "signup" });

		// A signup or magic-link token must not open the reset form.
		expect(parseRecoveryConfirmation(params)).toEqual({
			action: "invalid",
			reason: "unsupported_type",
		});
	});

	it("treats a Supabase error redirect as expired", () => {
		const params = new URLSearchParams({
			error: "access_denied",
			error_code: "otp_expired",
		});

		expect(parseRecoveryConfirmation(params)).toEqual({
			action: "invalid",
			reason: "provider",
		});
	});

	it("rejects missing and malformed secrets", () => {
		expect(parseRecoveryConfirmation(new URLSearchParams())).toEqual({
			action: "invalid",
			reason: "missing",
		});
		expect(parseRecoveryConfirmation(new URLSearchParams({ token_hash: "short" }))).toEqual({
			action: "invalid",
			reason: "malformed",
		});
		expect(parseRecoveryConfirmation(new URLSearchParams({ token_hash: "a".repeat(600) }))).toEqual(
			{ action: "invalid", reason: "malformed" },
		);
	});
});

describe("recoveryRedirectPath", () => {
	it("stays on this origin and preserves a valid single-use proof", () => {
		const { token } = mintPasswordResetProof("user-1");

		expect(recoveryRedirectPath("en", token)).toBe(
			`/en/reset-password?reset=${encodeURIComponent(token)}`,
		);
		expect(recoveryRedirectPath("hil", token)).toBe(
			`/hil/reset-password?reset=${encodeURIComponent(token)}`,
		);
	});

	it("drops a forged or malformed proof and defaults the locale", () => {
		expect(recoveryRedirectPath("en", "not-a-proof")).toBe("/en/reset-password");
		expect(recoveryRedirectPath("xx-not-a-locale", null)).toBe("/en/reset-password");
	});

	it("recognises only the minted proof shape", () => {
		const { token } = mintPasswordResetProof("user-1");

		expect(isRecoveryProof(token)).toBe(true);
		expect(isRecoveryProof("")).toBe(false);
		expect(isRecoveryProof("payload.signature")).toBe(false);
		// Shape only: the HMAC itself is checked by verifyPasswordResetProof.
		expect(isRecoveryProof(`${"a".repeat(3000)}.${"b".repeat(43)}`)).toBe(false);
	});
});

describe("confirmation route wiring (#741)", () => {
	const source = readFileSync(join(webRoot, "app/[locale]/auth/confirm/route.ts"), "utf8");

	it("consumes the SSR token_hash flow and the PKCE fallback", () => {
		expect(source).toContain("verifyOtp(");
		expect(source).toContain('type: "recovery"');
		expect(source).toContain("exchangeCodeForSession(");
	});

	it("only redirects to the localized reset page with the proof", () => {
		expect(source).toContain("recoveryRedirectPath(locale, failed ? null : resetToken)");
		// No caller-controlled destination is read from the query string.
		expect(source).not.toContain('searchParams.get("next")');
	});
});
