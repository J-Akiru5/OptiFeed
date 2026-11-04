import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two-step sign-in (#719).
 *
 * A verified factor must stop the password step from resolving a destination or
 * redirecting, and `completeMfaLogin()` must only redirect after Supabase has
 * accepted the code. A user with no factor must behave exactly as before.
 */

const mocks = vi.hoisted(() => ({
	createClient: vi.fn(),
	signInWithPassword: vi.fn(),
	getUser: vi.fn(),
	challengeAndVerify: vi.fn(),
	mfaRateLimit: vi.fn(),
	userFindUnique: vi.fn(),
	adminFindUnique: vi.fn(),
	resetLockout: vi.fn(),
	recordFailedAttempt: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: mocks.createClient,
}));

vi.mock("@/lib/rate-limit", () => ({
	checkLoginRateLimit: vi.fn(async () => ({ success: true, remaining: 4 })),
	checkMfaRateLimit: mocks.mfaRateLimit,
	getClientIp: vi.fn(async () => "203.0.113.9"),
}));

vi.mock("@/lib/auth/lockout", () => ({
	checkLockout: vi.fn(async () => ({ locked: false })),
	recordFailedAttempt: mocks.recordFailedAttempt,
	resetLockout: mocks.resetLockout,
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: mocks.userFindUnique },
		platformAdmin: { findUnique: mocks.adminFindUnique },
	},
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { redirect } from "@/i18n/routing";
import { completeMfaLogin, loginWithPassword } from "@/lib/actions/auth";

const redirectMock = vi.mocked(redirect);

const FACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const VERIFIED_TOTP = {
	id: FACTOR_ID,
	factor_type: "totp",
	status: "verified",
	created_at: "2026-11-04T00:00:00.000Z",
	updated_at: "2026-11-04T00:00:00.000Z",
};

function client() {
	return {
		auth: {
			signInWithPassword: mocks.signInWithPassword,
			getUser: mocks.getUser,
			mfa: { challengeAndVerify: mocks.challengeAndVerify },
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createClient.mockResolvedValue(client());
	mocks.mfaRateLimit.mockResolvedValue({ success: true, remaining: 9 });
	mocks.resetLockout.mockResolvedValue(undefined);
	mocks.recordFailedAttempt.mockResolvedValue(undefined);
	mocks.userFindUnique.mockResolvedValue({
		id: "user-1",
		farmId: "superadmin",
		mustChangePassword: false,
	});
	mocks.adminFindUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
});

describe("loginWithPassword with a verified factor", () => {
	it("stops after the password and asks for a code instead of redirecting", async () => {
		mocks.signInWithPassword.mockResolvedValue({
			error: null,
			data: { user: { id: "sb-1", factors: [VERIFIED_TOTP] } },
		});

		const result = await loginWithPassword("superadmin", "password123");

		expect(result).toEqual({ mfaRequired: true });
		expect(redirectMock).not.toHaveBeenCalled();
		expect(mocks.userFindUnique).not.toHaveBeenCalled();
		expect(mocks.adminFindUnique).not.toHaveBeenCalled();
	});

	it("keeps the existing single-step path when the account has no factor", async () => {
		mocks.signInWithPassword.mockResolvedValue({
			error: null,
			data: { user: { id: "sb-1", factors: [] } },
		});

		await loginWithPassword("demo-farmer-1", "password123");

		expect(redirectMock).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
	});
});

describe("completeMfaLogin", () => {
	it("verifies the code and redirects to the platform console", async () => {
		mocks.getUser.mockResolvedValue({
			data: {
				user: {
					id: "sb-1",
					email: "superadmin@pond.optifeed.local",
					factors: [VERIFIED_TOTP],
				},
			},
			error: null,
		});
		mocks.challengeAndVerify.mockResolvedValue({ data: null, error: null });

		await completeMfaLogin(" 123 456 ");

		expect(mocks.challengeAndVerify).toHaveBeenCalledWith({
			factorId: FACTOR_ID,
			code: "123456",
		});
		expect(redirectMock).toHaveBeenCalledWith({ href: "/superadmin", locale: "en" });
	});

	it("rejects a wrong code without touching the destination", async () => {
		mocks.getUser.mockResolvedValue({
			data: {
				user: { id: "sb-1", email: "superadmin@pond.optifeed.local", factors: [VERIFIED_TOTP] },
			},
			error: null,
		});
		mocks.challengeAndVerify.mockResolvedValue({
			data: null,
			error: new Error("Invalid TOTP code entered"),
		});

		expect(await completeMfaLogin("000000")).toEqual({ error: "invalid" });
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("rejects a malformed code before calling Supabase", async () => {
		expect(await completeMfaLogin("12")).toEqual({ error: "invalid" });
		expect(mocks.createClient).not.toHaveBeenCalled();
	});

	it("throttles repeated attempts", async () => {
		mocks.mfaRateLimit.mockResolvedValue({ success: false, remaining: 0 });
		expect(await completeMfaLogin("123456")).toEqual({ error: "rate_limited" });
		expect(mocks.getUser).not.toHaveBeenCalled();
	});

	it("finishes the sign-in when the factor disappeared (dashboard recovery)", async () => {
		mocks.getUser.mockResolvedValue({
			data: {
				user: { id: "sb-1", email: "superadmin@pond.optifeed.local", factors: [] },
			},
			error: null,
		});

		await completeMfaLogin("123456");

		expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
		expect(redirectMock).toHaveBeenCalledWith({ href: "/superadmin", locale: "en" });
	});

	it("fails closed on a factor type this build cannot verify", async () => {
		mocks.getUser.mockResolvedValue({
			data: {
				user: {
					id: "sb-1",
					email: "superadmin@pond.optifeed.local",
					factors: [{ ...VERIFIED_TOTP, factor_type: "phone" }],
				},
			},
			error: null,
		});

		expect(await completeMfaLogin("123456")).toEqual({ error: "unsupported" });
		expect(redirectMock).not.toHaveBeenCalled();
	});
});
