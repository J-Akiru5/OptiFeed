import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	cookieValue: "cookie-a-0123456789abcdef" as string | null,
	claims: vi.fn(),
	getUser: vi.fn(),
	createClient: vi.fn(),
	findUnique: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: state.createClient,
}));

vi.mock("@/lib/prisma", () => ({
	default: { user: { findUnique: state.findUnique } },
}));

// session.ts pulls these in; they cannot load under Vitest without a Next runtime.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import {
	__setCookieReaderForTests,
	cacheFarm,
	cacheSession,
	getCachedFarm,
	getCachedSession,
	invalidateFarm,
	sessionFingerprint,
} from "@/lib/auth/session-cache";
import { getVerifiedSession } from "@/lib/auth/verify-session";
import { withAuth } from "@/lib/auth/with-auth";

const CLAIMS = {
	sub: "sb-1",
	email: "demo-farmer-1@pond.optifeed.local",
	exp: Math.floor(Date.now() / 1000) + 3600,
};

beforeEach(() => {
	state.cookieValue = "cookie-a-0123456789abcdef";
	__setCookieReaderForTests(async () => ({
		getAll: () =>
			state.cookieValue ? [{ name: "sb-test-auth-token", value: state.cookieValue }] : [],
	}));
});

afterEach(() => {
	__setCookieReaderForTests(null);
});

describe("verified-session fast path", () => {
	beforeEach(() => {
		state.cookieValue = "cookie-a-0123456789abcdef";
		state.claims.mockReset();
		state.getUser.mockReset();
		state.findUnique.mockReset();
		state.createClient.mockReset();
		state.createClient.mockResolvedValue({
			auth: { getClaims: state.claims, getUser: state.getUser },
		});
	});

	it("returns null without touching Supabase when there is no session cookie", async () => {
		state.cookieValue = null;
		await expect(getVerifiedSession()).resolves.toBeNull();
		expect(state.createClient).not.toHaveBeenCalled();
	});

	it("verifies claims once and serves the second request from cache", async () => {
		state.claims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });

		await expect(getVerifiedSession()).resolves.toEqual({
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
		});
		await expect(getVerifiedSession()).resolves.toEqual({
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
		});

		expect(state.createClient).toHaveBeenCalledTimes(1);
		expect(state.claims).toHaveBeenCalledTimes(1);
		expect(state.getUser).not.toHaveBeenCalled();
	});

	it("re-verifies when the cookie changes", async () => {
		state.claims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
		await getVerifiedSession();

		state.cookieValue = "cookie-b-fedcba9876543210";
		await getVerifiedSession();

		expect(state.claims).toHaveBeenCalledTimes(2);
	});

	it("falls back to the server-verified getUser path when claims are unusable", async () => {
		state.claims.mockResolvedValue({ data: null, error: new Error("not asymmetric") });
		state.getUser.mockResolvedValue({
			data: { user: { id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" } },
			error: null,
		});

		await expect(getVerifiedSession()).resolves.toEqual({
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
		});
		expect(state.getUser).toHaveBeenCalledTimes(1);
	});

	it("rejects a claims object without an email", async () => {
		state.claims.mockResolvedValue({
			data: { claims: { sub: "sb-1", exp: CLAIMS.exp } },
			error: null,
		});
		state.getUser.mockResolvedValue({ data: { user: null }, error: null });

		await expect(getVerifiedSession()).resolves.toBeNull();
		expect(state.getUser).toHaveBeenCalledTimes(1);
	});

	it("does not cache an expired session", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		state.claims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });

		await getVerifiedSession();
		const fingerprint = await sessionFingerprint();
		expect(fingerprint).toBeTruthy();
		expect(getCachedSession(fingerprint ?? "")).not.toBeNull();

		vi.advanceTimersByTime(31_000);
		expect(getCachedSession(fingerprint ?? "")).toBeNull();

		await getVerifiedSession();
		expect(state.claims).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});

describe("farm binding cache", () => {
	it("caches a real farm id and returns it", () => {
		cacheFarm("sb-1", "demo-farmer-1");
		expect(getCachedFarm("sb-1")).toEqual({ farmId: "demo-farmer-1" });
	});

	it("never caches a missing farm, so provisioning is immediate", () => {
		cacheFarm("sb-2", null);
		expect(getCachedFarm("sb-2")).toBeNull();
	});

	it("invalidates both the farm binding and sessions for that user", async () => {
		const fingerprint = await sessionFingerprint();
		expect(fingerprint).toBeTruthy();
		cacheSession(fingerprint ?? "", {
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
			expMs: Date.now() + 60_000,
		});
		cacheFarm("sb-1", "demo-farmer-1");

		invalidateFarm("sb-1");

		expect(getCachedFarm("sb-1")).toBeNull();
		expect(getCachedSession(fingerprint ?? "")).toBeNull();
	});
});

describe("withAuth uses the cached identity and farm", () => {
	beforeEach(() => {
		state.createClient.mockReset();
		state.createClient.mockResolvedValue({
			auth: { getClaims: state.claims, getUser: state.getUser },
		});
		state.findUnique.mockReset();
	});

	it("runs the handler with no Supabase call and no DB lookup when both caches hit", async () => {
		const fingerprint = await sessionFingerprint();
		cacheSession(fingerprint ?? "", {
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
			expMs: Date.now() + 60_000,
		});
		cacheFarm("sb-1", "demo-farmer-1");

		const handler = withAuth(async (_request, context) => {
			return Response.json(context);
		});
		const response = await handler(new Request("http://local/api/v1/x") as never);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ownerId: "demo-farmer-1",
			user: { id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" },
		});
		expect(state.createClient).not.toHaveBeenCalled();
		expect(state.findUnique).not.toHaveBeenCalled();
	});

	it("resolves and then caches the farm binding on a cold cache", async () => {
		const fingerprint = await sessionFingerprint();
		cacheSession(fingerprint ?? "", {
			sub: "sb-1",
			email: "demo-farmer-1@pond.optifeed.local",
			expMs: Date.now() + 60_000,
		});
		state.findUnique.mockResolvedValue({ farmId: "demo-farmer-1" });

		const handler = withAuth(async (_request, context) => Response.json(context));
		const request = () => new Request("http://local/api/v1/x") as never;

		await handler(request());
		await handler(request());

		expect(state.findUnique).toHaveBeenCalledTimes(1);
	});
});
