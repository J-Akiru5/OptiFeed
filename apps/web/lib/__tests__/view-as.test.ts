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

const { db } = vi.hoisted(() => ({
	db: {
		impersonationSession: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { getCurrentUser } from "@/lib/auth/session";
import {
	VIEW_AS_COOKIE,
	VIEW_AS_MODE,
	VIEW_AS_TTL_MS,
	ViewAsReadOnlyError,
	assertNotViewingAs,
	clearViewAsCookie,
	createViewAsToken,
	isViewAsReadOnlyError,
	resolveViewAsState,
	setViewAsCookie,
	verifyViewAsToken,
} from "@/lib/auth/view-as";

const mockUser = vi.mocked(getCurrentUser);

const NOW = new Date("2026-10-26T10:00:00.000Z");
const ACTOR = "admin-1";
const SESSION = {
	actorUserId: ACTOR,
	orgId: "org-a",
	mode: VIEW_AS_MODE,
	reason: "Support call about a stuck feeder",
	expiresAt: new Date(NOW.getTime() + VIEW_AS_TTL_MS),
	endedAt: null as Date | null,
};

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
	mockUser.mockResolvedValue({ id: ACTOR } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.impersonationSession.findUnique.mockResolvedValue(SESSION);
	db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
});

function token(now: Date = NOW) {
	return createViewAsToken(
		{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
		now,
	);
}

function failureReason(result: ReturnType<typeof verifyViewAsToken>) {
	if (result.valid) throw new Error("expected failure");
	return result.reason;
}

describe("verifyViewAsToken", () => {
	it("rejects a missing cookie", () => {
		expect(failureReason(verifyViewAsToken(undefined, ACTOR, NOW))).toBe("missing");
		expect(failureReason(verifyViewAsToken("", ACTOR, NOW))).toBe("missing");
	});

	it("accepts a valid token and carries the target farm", () => {
		const result = verifyViewAsToken(token(), ACTOR, NOW);
		if (!result.valid) throw new Error("expected valid");
		expect(result.payload).toMatchObject({
			sid: "sess-1",
			actorUserId: ACTOR,
			orgId: "org-a",
			farmId: "farm-a",
		});
	});

	it("rejects a token older than 30 minutes", () => {
		const issuedAt = new Date(NOW.getTime() - VIEW_AS_TTL_MS);
		expect(failureReason(verifyViewAsToken(token(issuedAt), ACTOR, NOW))).toBe("expired");
	});

	it("rejects a forged payload and an altered signature", () => {
		const valid = token();
		const [, signature] = valid.split(".");
		const forged = Buffer.from(
			JSON.stringify({
				sid: "sess-1",
				actorUserId: ACTOR,
				orgId: "org-b",
				farmId: "farm-b",
				issuedAt: NOW.getTime(),
				expiresAt: NOW.getTime() + VIEW_AS_TTL_MS,
			}),
			"utf8",
		).toString("base64url");
		expect(failureReason(verifyViewAsToken(`${forged}.${signature}`, ACTOR, NOW))).toBe("tampered");

		const [payload, sig] = valid.split(".");
		const replacement = sig[5] === "A" ? "B" : "A";
		const flipped = `${sig.slice(0, 5)}${replacement}${sig.slice(6)}`;
		expect(failureReason(verifyViewAsToken(`${payload}.${flipped}`, ACTOR, NOW))).toBe("tampered");
	});

	it("rejects a token issued for another admin", () => {
		expect(failureReason(verifyViewAsToken(token(), "admin-2", NOW))).toBe("tampered");
	});
});

describe("resolveViewAsState", () => {
	it("is unauthenticated without a user", async () => {
		mockUser.mockResolvedValue(null);
		await expect(resolveViewAsState(NOW)).resolves.toEqual({
			active: false,
			reason: "unauthenticated",
		});
	});

	it("reports missing when no cookie is present", async () => {
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "missing" });
		expect(db.impersonationSession.findUnique).not.toHaveBeenCalled();
	});

	it("is active with a valid cookie, open session and live platform grant", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		await expect(resolveViewAsState(NOW)).resolves.toMatchObject({
			active: true,
			sessionId: "sess-1",
			orgId: "org-a",
			farmId: "farm-a",
			reason: SESSION.reason,
			expiresAt: SESSION.expiresAt,
		});
	});

	it("ends at expiry: an expired session row is inactive", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.impersonationSession.findUnique.mockResolvedValue({
			...SESSION,
			expiresAt: new Date(NOW.getTime() - 1),
		});
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "expired" });
	});

	it("is inactive after an explicit exit (endedAt set)", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.impersonationSession.findUnique.mockResolvedValue({
			...SESSION,
			endedAt: new Date(NOW.getTime() - 1000),
		});
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "ended" });
	});

	it("fails closed when the admin's grant was revoked", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.platformAdmin.findUnique.mockResolvedValue({
			revokedAt: new Date(NOW.getTime() - 1000),
			expiresAt: null,
		});
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "revoked" });
	});

	it("rejects a session whose org does not match the signed cookie", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.impersonationSession.findUnique.mockResolvedValue({ ...SESSION, orgId: "org-b" });
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "mismatch" });
	});

	it("rejects a non-read-only session mode", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.impersonationSession.findUnique.mockResolvedValue({ ...SESSION, mode: "READ_WRITE" });
		await expect(resolveViewAsState(NOW)).resolves.toEqual({ active: false, reason: "mismatch" });
	});

	it("fails closed (inactive, never throws) when the lookup fails", async () => {
		jar.set(VIEW_AS_COOKIE, token());
		db.impersonationSession.findUnique.mockRejectedValue(new Error("db down"));
		await expect(resolveViewAsState(NOW)).resolves.toEqual({
			active: false,
			reason: "unavailable",
		});
	});
});

describe("assertNotViewingAs (the shared write guard)", () => {
	it("throws a typed read-only error while a session is active", async () => {
		// getViewAsState reads the real clock, so issue a token that is valid now.
		const now = new Date();
		jar.set(
			VIEW_AS_COOKIE,
			createViewAsToken(
				{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
				now,
			),
		);
		db.impersonationSession.findUnique.mockResolvedValue({
			...SESSION,
			expiresAt: new Date(now.getTime() + 60_000),
		});
		const error = await assertNotViewingAs().catch((e) => e);
		expect(error).toBeInstanceOf(ViewAsReadOnlyError);
		expect(isViewAsReadOnlyError(error)).toBe(true);
		expect(error).toMatchObject({ code: "view_as_read_only" });
	});

	it("resolves when no session is active", async () => {
		await expect(assertNotViewingAs()).resolves.toBeUndefined();
	});
});

describe("cookie lifecycle", () => {
	it("sets an httpOnly cookie bound to the session expiry", async () => {
		const expiresAt = new Date(NOW.getTime() + VIEW_AS_TTL_MS);
		await setViewAsCookie(token(), expiresAt);

		const write = cookieWrites.find((entry) => entry.name === VIEW_AS_COOKIE);
		expect(write?.options).toMatchObject({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			expires: expiresAt,
		});
	});

	it("clears the cookie", async () => {
		jar.set(VIEW_AS_COOKIE, "value");
		await clearViewAsCookie();
		expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
	});
});
