import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { jar, cookieWrites } = vi.hoisted(() => ({
	jar: new Map<string, string>(),
	cookieWrites: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		set: (name: string, value: string, options?: Record<string, unknown>) => {
			jar.set(name, value);
			cookieWrites.push({ name, value, options: options ?? {} });
		},
		delete: (name: string) => {
			jar.delete(name);
		},
	})),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/session";
import {
	STEP_UP_COOKIE,
	STEP_UP_TTL_MS,
	StepUpRequiredError,
	clearStepUpCookie,
	createStepUpToken,
	getStepUpState,
	isStepUpRequiredError,
	requireStepUp,
	setStepUpCookie,
	verifyStepUpToken,
	withStepUp,
} from "@/lib/auth/step-up";

const mockUser = vi.mocked(getCurrentUser);

const NOW = new Date("2026-10-26T10:00:00.000Z");
const ADMIN = "admin-1";

const originalSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeAll(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterAll(() => {
	if (originalSecret === undefined) {
		Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
	} else {
		process.env.SUPABASE_SERVICE_ROLE_KEY = originalSecret;
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	jar.clear();
	cookieWrites.length = 0;
	mockUser.mockResolvedValue({ id: ADMIN } as Awaited<ReturnType<typeof getCurrentUser>>);
});

function expectedStepUpFailure(result: ReturnType<typeof verifyStepUpToken>) {
	if (result.valid) throw new Error("expected failure");
	return result.reason;
}

describe("verifyStepUpToken", () => {
	it("rejects a missing cookie", () => {
		expect(expectedStepUpFailure(verifyStepUpToken(undefined, ADMIN, NOW))).toBe("missing");
		expect(expectedStepUpFailure(verifyStepUpToken("", ADMIN, NOW))).toBe("missing");
	});

	it("accepts a valid token and reports when the password was verified", () => {
		const result = verifyStepUpToken(createStepUpToken(ADMIN, NOW), ADMIN, NOW);
		expect(result).toEqual({ valid: true, stepUpAt: NOW });
	});

	it("rejects a token older than five minutes", () => {
		const issuedAt = new Date(NOW.getTime() - STEP_UP_TTL_MS);
		const result = verifyStepUpToken(createStepUpToken(ADMIN, issuedAt), ADMIN, NOW);
		expect(expectedStepUpFailure(result)).toBe("expired");
	});

	it("rejects a token whose payload was tampered with", () => {
		const token = createStepUpToken(ADMIN, NOW);
		const [, signature] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({
				userId: "someone-else",
				issuedAt: NOW.getTime(),
				expiresAt: NOW.getTime() + STEP_UP_TTL_MS,
			}),
			"utf8",
		).toString("base64url");
		expect(expectedStepUpFailure(verifyStepUpToken(`${forged}.${signature}`, ADMIN, NOW))).toBe(
			"tampered",
		);
	});

	it("rejects a token whose signature was altered", () => {
		const token = createStepUpToken(ADMIN, NOW);
		const [payload, signature] = token.split(".");
		const replacement = signature[5] === "A" ? "B" : "A";
		const flipped = `${signature.slice(0, 5)}${replacement}${signature.slice(6)}`;
		expect(expectedStepUpFailure(verifyStepUpToken(`${payload}.${flipped}`, ADMIN, NOW))).toBe(
			"tampered",
		);
	});

	it("rejects a valid token issued for another user", () => {
		const token = createStepUpToken("admin-2", NOW);
		expect(expectedStepUpFailure(verifyStepUpToken(token, ADMIN, NOW))).toBe("tampered");
	});

	it("rejects a malformed token", () => {
		expect(expectedStepUpFailure(verifyStepUpToken("not-a-token", ADMIN, NOW))).toBe("tampered");
	});
});

describe("getStepUpState and requireStepUp", () => {
	it("reports missing when there is no cookie", async () => {
		await expect(getStepUpState(NOW)).resolves.toEqual({
			active: false,
			stepUpAt: null,
			reason: "missing",
		});
	});

	it("reports expired for an old cookie", async () => {
		jar.set(STEP_UP_COOKIE, createStepUpToken(ADMIN, new Date(NOW.getTime() - STEP_UP_TTL_MS)));
		await expect(getStepUpState(NOW)).resolves.toMatchObject({
			active: false,
			reason: "expired",
		});
	});

	it("reports tampered for a forged cookie", async () => {
		jar.set(STEP_UP_COOKIE, `${createStepUpToken(ADMIN, NOW)}x`);
		await expect(getStepUpState(NOW)).resolves.toMatchObject({
			active: false,
			reason: "tampered",
		});
	});

	it("is active with a valid cookie", async () => {
		jar.set(STEP_UP_COOKIE, createStepUpToken(ADMIN, NOW));
		await expect(getStepUpState(NOW)).resolves.toEqual({ active: true, stepUpAt: NOW });
	});

	it("is unauthenticated without a user", async () => {
		mockUser.mockResolvedValue(null);
		jar.set(STEP_UP_COOKIE, createStepUpToken(ADMIN, NOW));
		await expect(getStepUpState(NOW)).resolves.toEqual({
			active: false,
			stepUpAt: null,
			reason: "unauthenticated",
		});
	});

	it("requireStepUp throws a typed error without a cookie", async () => {
		await expect(requireStepUp(NOW)).rejects.toBeInstanceOf(StepUpRequiredError);
		await expect(requireStepUp(NOW)).rejects.toMatchObject({
			code: "step_up_required",
			reason: "missing",
		});
	});

	it("requireStepUp returns the verification time with a valid cookie", async () => {
		jar.set(STEP_UP_COOKIE, createStepUpToken(ADMIN, NOW));
		await expect(requireStepUp(NOW)).resolves.toEqual(NOW);
	});
});

describe("withStepUp", () => {
	it("does not run the action without a fresh check", async () => {
		const action = vi.fn();
		await expect(withStepUp(action, NOW)).rejects.toMatchObject({ code: "step_up_required" });
		expect(action).not.toHaveBeenCalled();
	});

	it("passes the verification time to the action", async () => {
		jar.set(STEP_UP_COOKIE, createStepUpToken(ADMIN, NOW));
		const action = vi.fn(async (stepUpAt: Date) => stepUpAt.toISOString());
		await expect(withStepUp(action, NOW)).resolves.toBe(NOW.toISOString());
		expect(action).toHaveBeenCalledWith(NOW);
	});
});

describe("cookie lifecycle", () => {
	it("sets a signed httpOnly cookie for five minutes", async () => {
		await setStepUpCookie(ADMIN, NOW);

		const write = cookieWrites.find((entry) => entry.name === STEP_UP_COOKIE);
		expect(write).toBeDefined();
		expect(write?.options).toMatchObject({
			httpOnly: true,
			sameSite: "strict",
			path: "/",
			maxAge: 300,
		});
		expect(verifyStepUpToken(write?.value, ADMIN, NOW)).toEqual({ valid: true, stepUpAt: NOW });
	});

	it("clears the cookie", async () => {
		jar.set(STEP_UP_COOKIE, "value");
		await clearStepUpCookie();
		expect(jar.has(STEP_UP_COOKIE)).toBe(false);
	});
});

describe("isStepUpRequiredError", () => {
	it("recognises the typed error and a cross-module equivalent", () => {
		expect(isStepUpRequiredError(new StepUpRequiredError("missing"))).toBe(true);
		expect(isStepUpRequiredError({ code: "step_up_required", message: "x" })).toBe(true);
		expect(isStepUpRequiredError(new Error("boom"))).toBe(false);
		expect(isStepUpRequiredError(null)).toBe(false);
	});
});
