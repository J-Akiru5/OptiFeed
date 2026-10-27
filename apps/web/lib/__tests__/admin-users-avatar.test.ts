import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	count: vi.fn(),
	findMany: vi.fn(),
	membershipFindMany: vi.fn(),
	platformAdminFindMany: vi.fn(),
	createSignedUrls: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { count: mocks.count, findMany: mocks.findMany },
		membership: { findMany: mocks.membershipFindMany },
		platformAdmin: { findMany: mocks.platformAdminFindMany },
	},
}));
vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn(async () => undefined),
	TENANT_ADMIN_ROLES: ["OWNER", "ADMIN"],
}));
vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-1"],
		memberUserIds: ["u1"],
		farmIds: ["farm-1"],
		pondIds: [],
	})),
}));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({
		storage: { from: () => ({ createSignedUrls: mocks.createSignedUrls }) },
	}),
}));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	buildPondEmail: vi.fn((farmId: string) => `${farmId}@pond.optifeed.local`),
	getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/password", () => ({
	passwordErrorMessage: vi.fn(),
	validatePassword: vi.fn(),
}));
vi.mock("@/lib/membership-invite", () => ({ inviteOrAttachMember: vi.fn() }));
vi.mock("@/lib/notify/invite-email", () => ({ deliverMemberInviteEmail: vi.fn() }));
vi.mock("@/lib/actions/admin-internal", () => ({ deleteUserSubtree: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkDeviceTokenRevealRateLimit: vi.fn() }));

import { getUsers } from "@/lib/actions/admin";

/**
 * The tenant user list is a browser-callable server action. It may hand the
 * client a signed URL for a picture it is allowed to see, but never the object
 * key in the private bucket (#198, E20).
 */
describe("getUsers avatars", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.platformAdminFindMany.mockResolvedValue([]);
		mocks.membershipFindMany.mockResolvedValue([]);
		mocks.count.mockResolvedValue(1);
		mocks.findMany.mockResolvedValue([
			{
				id: "u1",
				supabaseId: "sb-1",
				farmId: "farm-1",
				email: "juan@pond.optifeed.local",
				displayName: "Juan Miguel",
				role: "OPERATOR",
				mustChangePassword: false,
				avatarPath: "u1/abc.webp",
				createdAt: new Date("2026-10-01T00:00:00Z"),
				updatedAt: new Date("2026-10-01T00:00:00Z"),
				farm: null,
			},
		]);
		mocks.createSignedUrls.mockResolvedValue({
			data: [{ path: "u1/abc.webp", signedUrl: "https://signed/u1", error: null }],
			error: null,
		});
	});

	it("returns a signed URL instead of the storage key", async () => {
		const page = await getUsers({ page: 1, pageSize: 20 });

		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]?.avatarUrl).toBe("https://signed/u1");
		expect(Object.hasOwn(page.rows[0] ?? {}, "avatarPath")).toBe(false);
	});

	it("still lists the user with initials when signing fails", async () => {
		mocks.createSignedUrls.mockResolvedValue({ data: null, error: { message: "down" } });

		const page = await getUsers({ page: 1, pageSize: 20 });

		expect(page.rows[0]?.avatarUrl).toBeNull();
		expect(Object.hasOwn(page.rows[0] ?? {}, "avatarPath")).toBe(false);
	});
});
