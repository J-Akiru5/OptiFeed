import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { jar, signInWithPassword } = vi.hoisted(() => ({
	jar: new Map<string, string>(),
	signInWithPassword: vi.fn(),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		set: (name: string, value: string) => {
			jar.set(name, value);
		},
		delete: (name: string) => {
			jar.delete(name);
		},
	})),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkStepUpRateLimit: vi.fn() }));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
	createClient: vi.fn(() => ({ auth: { signInWithPassword } })),
}));

import { startStepUp } from "@/lib/actions/step-up";
import { getCurrentUser } from "@/lib/auth/session";
import { STEP_UP_COOKIE, requireStepUp } from "@/lib/auth/step-up";
import { checkStepUpRateLimit } from "@/lib/rate-limit";

const mockUser = vi.mocked(getCurrentUser);
const mockLimit = vi.mocked(checkStepUpRateLimit);

const originalSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeAll(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
	process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterAll(() => {
	if (originalSecret === undefined)
		Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
	else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSecret;
	if (originalUrl === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
	else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
	if (originalAnonKey === undefined) {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
	} else {
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	jar.clear();
	mockUser.mockResolvedValue({
		id: "admin-1",
		email: "admin@pond.optifeed.local",
	} as Awaited<ReturnType<typeof getCurrentUser>>);
	mockLimit.mockResolvedValue({ success: true, remaining: 4 });
	signInWithPassword.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
});

describe("startStepUp", () => {
	it("rejects an empty password without calling Supabase", async () => {
		await expect(startStepUp("")).resolves.toEqual({ error: "Enter your password." });
		expect(signInWithPassword).not.toHaveBeenCalled();
	});

	it("rejects an unauthenticated caller", async () => {
		mockUser.mockResolvedValue(null);
		await expect(startStepUp("secret")).resolves.toEqual({ error: "Not authenticated." });
		expect(signInWithPassword).not.toHaveBeenCalled();
	});

	it("throttles attempts before verifying a credential", async () => {
		mockLimit.mockResolvedValue({ success: false, remaining: 0 });
		await expect(startStepUp("secret")).resolves.toEqual({
			error: "Too many attempts. Wait a few minutes and try again.",
		});
		expect(mockLimit).toHaveBeenCalledWith("admin-1");
		expect(signInWithPassword).not.toHaveBeenCalled();
	});

	it("rejects a wrong password and sets no cookie", async () => {
		signInWithPassword.mockResolvedValue({
			data: { user: null },
			error: { message: "Invalid login credentials" },
		});
		await expect(startStepUp("wrong")).resolves.toEqual({
			error: "That password is not correct.",
		});
		expect(jar.has(STEP_UP_COOKIE)).toBe(false);
	});

	it("verifies against the current user's own email", async () => {
		await startStepUp("correct");
		expect(signInWithPassword).toHaveBeenCalledWith({
			email: "admin@pond.optifeed.local",
			password: "correct",
		});
	});

	it("sets a usable step-up cookie after a correct password", async () => {
		const result = await startStepUp("correct");

		expect(result).toMatchObject({ success: true });
		expect(jar.has(STEP_UP_COOKIE)).toBe(true);
		await expect(requireStepUp()).resolves.toBeInstanceOf(Date);
	});
});
