import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session reads for MFA (#719).
 *
 * These helpers must never throw into a page render: a missing session or an
 * auth-server hiccup resolves to "no level" / "no factors", and the normal auth
 * gate decides what to do instead.
 */

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
	getSessionMfaLevel,
	isMfaChallengePendingForSession,
	listTotpFactors,
} from "@/lib/auth/mfa";

function client(aal: unknown, factors: unknown) {
	mocks.createClient.mockResolvedValue({
		auth: {
			mfa: {
				getAuthenticatorAssuranceLevel: vi.fn(async () => aal),
				listFactors: vi.fn(async () => factors),
			},
		},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getSessionMfaLevel", () => {
	it("returns the session's current and next level", async () => {
		client(
			{ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null },
			{ data: { all: [] }, error: null },
		);
		expect(await getSessionMfaLevel()).toEqual({ currentLevel: "aal1", nextLevel: "aal2" });
	});

	it("returns null when Supabase reports an error", async () => {
		client({ data: null, error: new Error("no session") }, { data: { all: [] }, error: null });
		expect(await getSessionMfaLevel()).toBeNull();
	});

	it("returns null instead of throwing when the client cannot be built", async () => {
		mocks.createClient.mockRejectedValueOnce(new Error("outside a request scope"));
		expect(await getSessionMfaLevel()).toBeNull();
	});
});

describe("isMfaChallengePendingForSession", () => {
	it("is true for a password session with a verified factor", async () => {
		client(
			{ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null },
			{ data: { all: [] }, error: null },
		);
		expect(await isMfaChallengePendingForSession()).toBe(true);
	});

	it("is false for an account with no factor", async () => {
		client(
			{ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null },
			{ data: { all: [] }, error: null },
		);
		expect(await isMfaChallengePendingForSession()).toBe(false);
	});
});

describe("listTotpFactors", () => {
	it("returns TOTP metadata only, without secrets", async () => {
		client(
			{ data: null, error: null },
			{
				data: {
					all: [
						{
							id: "factor-1",
							factor_type: "totp",
							status: "verified",
							created_at: "2026-11-04T00:00:00.000Z",
							friendly_name: "OptiFeed",
						},
						{
							id: "factor-2",
							factor_type: "phone",
							status: "verified",
							created_at: "2026-11-04T00:00:00.000Z",
						},
					],
				},
				error: null,
			},
		);

		expect(await listTotpFactors()).toEqual([
			{
				id: "factor-1",
				status: "verified",
				createdAt: "2026-11-04T00:00:00.000Z",
				friendlyName: "OptiFeed",
			},
		]);
	});

	it("returns an empty list when Supabase fails", async () => {
		client({ data: null, error: null }, { data: null, error: new Error("unavailable") });
		expect(await listTotpFactors()).toEqual([]);
	});

	it("returns an empty list instead of throwing when the client cannot be built", async () => {
		mocks.createClient.mockRejectedValueOnce(new Error("outside a request scope"));
		expect(await listTotpFactors()).toEqual([]);
	});
});
