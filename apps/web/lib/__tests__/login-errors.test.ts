import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => {
	const auth = {
		getUser: vi.fn(async () => ({ data: { user: null } })),
		signInWithPassword: vi.fn(),
	};
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/prisma", () => ({
	default: {
		loginLockout: {
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			upsert: vi.fn(),
		},
		userLockout: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
		user: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
		pond: { findFirst: vi.fn() },
		notification: { create: vi.fn() },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkLoginRateLimit: vi.fn(async () => ({ success: true, remaining: 4 })),
	getClientIp: vi.fn(async () => "203.0.113.9"),
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { redirect } from "@/i18n/routing";
import { loginWithPassword } from "@/lib/actions/auth";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const loginLockout = vi.mocked(prisma.loginLockout);
const userLockout = vi.mocked(prisma.userLockout);
const user = vi.mocked(prisma.user);
const platformAdmin = vi.mocked(prisma.platformAdmin);
const redirectMock = vi.mocked(redirect);

const USER_ROW = {
	id: "user-1",
	farmId: "demo-farmer-1",
	mustChangePassword: false,
};

async function stubSupabaseSignIn(
	result:
		| { error: { message: string } | null; data?: { user: { id: string } | null } }
		| { error: null; data: { user: { id: string } } },
) {
	const client = await createClient();
	client.auth.signInWithPassword = vi.fn(async () => result) as never;
}

describe("loginWithPassword error handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loginLockout.findUnique.mockResolvedValue(null);
		userLockout.findUnique.mockResolvedValue(null);
		loginLockout.upsert.mockResolvedValue({} as never);
		user.findUnique.mockResolvedValue(USER_ROW as never);
		platformAdmin.findUnique.mockResolvedValue(null);
	});

	it("returns a friendly 'service' error when an unexpected error occurs", async () => {
		// checkLockout throws a non-transient error — not swallowed, mapped to "service"
		loginLockout.findUnique.mockRejectedValue(new Error("boom"));

		const result = await loginWithPassword("demo-farmer-1", "password123");
		expect(result).toEqual({ error: "service" });
	});

	it("retries once on a transient P1001 error, then succeeds", async () => {
		const transient = Object.assign(new Error("can't reach database"), { code: "P1001" });
		loginLockout.findUnique.mockRejectedValueOnce(transient).mockResolvedValue(null);
		await stubSupabaseSignIn({ error: null, data: { user: { id: "sb-1" } } });

		// Success path calls redirect — which the mocked routing ignores, so the
		// function returns undefined. The key assertion: two lockout lookups ran.
		await loginWithPassword("demo-farmer-1", "password123");
		expect(loginLockout.findUnique).toHaveBeenCalledTimes(2);
	});

	it("returns 'invalid' on a wrong password (not 'service')", async () => {
		await stubSupabaseSignIn({ error: { message: "Invalid login credentials" } });

		const result = await loginWithPassword("demo-farmer-1", "wrong-password-123");
		expect(result).toEqual({ error: "invalid" });
		// The failed attempt was recorded against the (farm, IP) pair
		expect(loginLockout.findUnique).toHaveBeenCalled();
	});

	it("accepts a legacy numeric PIN as a password", async () => {
		await stubSupabaseSignIn({ error: null, data: { user: { id: "sb-1" } } });

		await loginWithPassword("demo-farmer-1", "1234");

		const client = await createClient();
		expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
			email: "demo-farmer-1@pond.optifeed.local",
			password: "1234",
		});
	});

	it("redirects a temporary-password account to /change-password", async () => {
		user.findUnique.mockResolvedValue({ ...USER_ROW, mustChangePassword: true } as never);
		await stubSupabaseSignIn({ error: null, data: { user: { id: "sb-1" } } });

		await loginWithPassword("demo-farmer-1", "password123");

		expect(redirectMock).toHaveBeenCalledWith({
			href: "/change-password",
			locale: "en",
		});
	});

	it("redirects an active platform admin to /superadmin", async () => {
		user.findUnique.mockResolvedValue({ ...USER_ROW, farmId: "superadmin" } as never);
		platformAdmin.findUnique.mockResolvedValue({
			revokedAt: null,
			expiresAt: null,
		} as never);
		await stubSupabaseSignIn({ error: null, data: { user: { id: "sb-1" } } });

		await loginWithPassword("superadmin", "password123");

		expect(redirectMock).toHaveBeenCalledWith({
			href: "/superadmin",
			locale: "en",
		});
	});
});
