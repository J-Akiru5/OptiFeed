import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #583: `requireWriteAccess()` and `canWrite()` must decide from the caller's
 * membership in an ACTIVE organization, not from the legacy `User.role`
 * column. The pure policy lives in `write-access.ts`; this file proves the two
 * exported gates actually use it, including the fallback for accounts that
 * predate memberships and the denial for revoked memberships.
 */

const mocks = vi.hoisted(() => ({
	user: { findUnique: vi.fn() },
	membership: { findMany: vi.fn(), count: vi.fn() },
	organization: { findMany: vi.fn() },
	pond: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks }));

vi.mock("@/lib/supabase/server", () => {
	const auth = {
		getClaims: vi.fn(async () => ({
			data: { claims: { sub: "sb-1", email: "farm-1@pond.optifeed.local" } },
			error: null,
		})),
		getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
	};
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/auth/session-cache", () => ({
	sessionFingerprint: vi.fn(async () => {
		throw new Error("no request scope in unit tests");
	}),
	getCachedSession: vi.fn(() => null),
	cacheSession: vi.fn(),
	invalidateFarm: vi.fn(),
}));

vi.mock("@/lib/auth/view-as", () => ({
	assertNotViewingAs: vi.fn(async () => undefined),
	isViewingAs: vi.fn(async () => false),
	getViewAsState: vi.fn(async () => ({ active: false })),
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { ActionDeniedError } from "@/lib/auth/action-denial";
import { canWrite, requireWriteAccess } from "@/lib/auth/session";
import { assertNotViewingAs, isViewingAs } from "@/lib/auth/view-as";

const USER = {
	id: "user-1",
	farmId: "farm-1",
	supabaseId: "sb-1",
	role: "OPERATOR",
	mustChangePassword: false,
};

function signInAs(user: typeof USER | null) {
	mocks.user.findUnique.mockResolvedValue(user as never);
}

function memberships(rows: Array<{ orgId: string; role: string }>) {
	mocks.membership.findMany.mockResolvedValue(rows as never);
	mocks.organization.findMany.mockResolvedValue(
		[...new Set(rows.map((row) => row.orgId))].map((id) => ({ id })) as never,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	signInAs(USER);
	memberships([]);
	mocks.membership.count.mockResolvedValue(0);
	vi.mocked(isViewingAs).mockResolvedValue(false);
	vi.mocked(assertNotViewingAs).mockResolvedValue(undefined);
});

describe("requireWriteAccess reads the membership (#583)", () => {
	it("refuses a demoted VIEWER even though User.role is still OPERATOR", async () => {
		memberships([{ orgId: "org-1", role: "VIEWER" }]);

		await expect(requireWriteAccess()).rejects.toBeInstanceOf(ActionDeniedError);
		await expect(requireWriteAccess()).rejects.toMatchObject({ reason: "wrong_role" });
	});

	it("allows an OPERATOR membership even when User.role says VIEWER", async () => {
		signInAs({ ...USER, role: "VIEWER" });
		memberships([{ orgId: "org-1", role: "OPERATOR" }]);

		await expect(requireWriteAccess()).resolves.toBeUndefined();
	});

	it("allows an OWNER membership", async () => {
		memberships([{ orgId: "org-1", role: "OWNER" }]);

		await expect(requireWriteAccess()).resolves.toBeUndefined();
	});

	it("falls back to the legacy role only when the account has no membership row", async () => {
		memberships([]);
		mocks.membership.count.mockResolvedValue(0);

		await expect(requireWriteAccess()).resolves.toBeUndefined();
	});

	it("refuses a legacy ADMIN whose memberships were all revoked", async () => {
		signInAs({ ...USER, role: "ADMIN" });
		memberships([]);
		mocks.membership.count.mockResolvedValue(1);

		await expect(requireWriteAccess()).rejects.toMatchObject({ reason: "wrong_role" });
	});

	it("refuses a membership in a suspended organization instead of falling back", async () => {
		signInAs({ ...USER, role: "ADMIN" });
		mocks.membership.findMany.mockResolvedValue([
			{ orgId: "org-suspended", role: "OWNER" },
		] as never);
		mocks.organization.findMany.mockResolvedValue([] as never);

		await expect(requireWriteAccess()).rejects.toMatchObject({ reason: "wrong_role" });
	});

	it("throws not_authenticated without a session", async () => {
		signInAs(null);

		await expect(requireWriteAccess()).rejects.toMatchObject({ reason: "not_authenticated" });
	});

	it("keeps the password-change denial", async () => {
		signInAs({ ...USER, mustChangePassword: true });
		memberships([{ orgId: "org-1", role: "OWNER" }]);

		await expect(requireWriteAccess()).rejects.toMatchObject({
			reason: "password_change_required",
		});
	});

	it("still refuses a read-only view-as session", async () => {
		memberships([{ orgId: "org-1", role: "OWNER" }]);
		vi.mocked(assertNotViewingAs).mockRejectedValueOnce(new Error("view-as is read-only"));

		await expect(requireWriteAccess()).rejects.toThrow("view-as is read-only");
	});
});

describe("canWrite matches the server gate (#583)", () => {
	it("is false for a demoted VIEWER whose legacy role is OPERATOR", async () => {
		memberships([{ orgId: "org-1", role: "VIEWER" }]);

		expect(await canWrite()).toBe(false);
	});

	it("is true for an OPERATOR membership", async () => {
		memberships([{ orgId: "org-1", role: "OPERATOR" }]);

		expect(await canWrite()).toBe(true);
	});

	it("is false for a revoked membership even when the legacy role is ADMIN", async () => {
		signInAs({ ...USER, role: "ADMIN" });
		memberships([]);
		mocks.membership.count.mockResolvedValue(1);

		expect(await canWrite()).toBe(false);
	});

	it("is false while viewing as another tenant", async () => {
		memberships([{ orgId: "org-1", role: "OWNER" }]);
		vi.mocked(isViewingAs).mockResolvedValue(true);

		expect(await canWrite()).toBe(false);
	});
});
