import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Read-only view-as must fail closed.
 *
 * `assertNotViewingAs` is the shared write guard behind `requireWriteAccess`,
 * `canWrite` and `requirePermission`. When the view-as lookup itself fails (a
 * database blip, not an ended session) the guard cannot prove that the caller is
 * NOT impersonating a tenant, so it must refuse the write instead of treating
 * the session as inactive.
 */

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

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

const { db } = vi.hoisted(() => ({
	db: {
		impersonationSession: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/session";
import {
	VIEW_AS_COOKIE,
	assertNotViewingAs,
	createViewAsToken,
	getViewAsState,
} from "@/lib/auth/view-as";

const ACTOR = "admin-1";
const mockUser = vi.mocked(getCurrentUser);

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

function setCookie() {
	jar.set(
		VIEW_AS_COOKIE,
		createViewAsToken(
			{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
			new Date(),
		),
	);
}

function liveSession() {
	return {
		actorUserId: ACTOR,
		orgId: "org-a",
		mode: "READ_ONLY",
		reason: "Support call",
		expiresAt: new Date(Date.now() + 60_000),
		endedAt: null,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	jar.clear();
	mockUser.mockResolvedValue({ id: ACTOR } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
	db.impersonationSession.findUnique.mockResolvedValue(liveSession());
});

describe("assertNotViewingAs fails closed", () => {
	it("refuses a write when an active view-as session exists", async () => {
		setCookie();

		await expect(assertNotViewingAs()).rejects.toThrow(/read-only view-as/i);
	});

	it("refuses a write when the view-as lookup fails (cannot prove read-write)", async () => {
		setCookie();
		db.impersonationSession.findUnique.mockRejectedValue(new Error("connection reset"));

		await expect(assertNotViewingAs()).rejects.toThrow(/could not be verified/i);
		await expect(getViewAsState()).resolves.toMatchObject({
			active: false,
			reason: "unavailable",
		});
	});

	it("allows a write when no view-as cookie exists", async () => {
		await expect(assertNotViewingAs()).resolves.toBeUndefined();
		expect(db.impersonationSession.findUnique).not.toHaveBeenCalled();
	});

	it("allows a write when the cookie points at no live session", async () => {
		setCookie();
		db.impersonationSession.findUnique.mockResolvedValue(null);

		await expect(assertNotViewingAs()).resolves.toBeUndefined();
	});

	it("allows a write once the admin's platform grant is revoked", async () => {
		setCookie();
		db.platformAdmin.findUnique.mockResolvedValue({
			revokedAt: new Date(),
			expiresAt: null,
		});

		await expect(assertNotViewingAs()).resolves.toBeUndefined();
	});
});
