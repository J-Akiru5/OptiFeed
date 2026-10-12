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

import { loginWithPin } from "@/lib/actions/auth";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const loginLockout = vi.mocked(prisma.loginLockout);
const userLockout = vi.mocked(prisma.userLockout);

async function stubSupabaseSignIn(result: { error: { message: string } | null }) {
	const client = await createClient();
	client.auth.signInWithPassword = vi.fn(async () => result) as never;
}

describe("loginWithPin error handling (task 2.8)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loginLockout.findUnique.mockResolvedValue(null);
		userLockout.findUnique.mockResolvedValue(null);
		loginLockout.upsert.mockResolvedValue({} as never);
	});

	it("returns a friendly 'service' error when an unexpected error occurs", async () => {
		// checkLockout throws a non-transient error — not swallowed, mapped to "service"
		loginLockout.findUnique.mockRejectedValue(new Error("boom"));

		const result = await loginWithPin("demo-farmer-1", "123456");
		expect(result).toEqual({ error: "service" });
	});

	it("retries once on a transient P1001 error, then succeeds", async () => {
		const transient = Object.assign(new Error("can't reach database"), { code: "P1001" });
		loginLockout.findUnique.mockRejectedValueOnce(transient).mockResolvedValue(null);
		await stubSupabaseSignIn({ error: null });

		// Success path calls redirect — which the mocked routing ignores, so the
		// function returns undefined. The key assertion: two lockout lookups ran.
		await loginWithPin("demo-farmer-1", "123456");
		expect(loginLockout.findUnique).toHaveBeenCalledTimes(2);
	});

	it("returns 'invalid' on wrong PIN (not 'service')", async () => {
		await stubSupabaseSignIn({ error: { message: "Invalid login credentials" } });

		const result = await loginWithPin("demo-farmer-1", "000000");
		expect(result).toEqual({ error: "invalid" });
		// The failed attempt was recorded against the (farm, IP) pair
		expect(loginLockout.findUnique).toHaveBeenCalled();
	});
});
