import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(),
}));

import { redirect } from "@/i18n/routing";
import { assertPasswordChanged, getCurrentUser } from "@/lib/auth/session";
import { getTenantAdminState, requireTenantAdmin } from "@/lib/auth/tenant-admin";
import prisma from "@/lib/prisma";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockAssertPasswordChanged = vi.mocked(assertPasswordChanged);
const mockMembershipFindMany = vi.mocked(prisma.membership.findMany);
const mockOrganizationFindMany = vi.mocked(prisma.organization.findMany);
const mockRedirect = vi.mocked(redirect);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getTenantAdminState", () => {
	it("denies a caller with no session", async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		await expect(getTenantAdminState()).resolves.toEqual({
			isAdmin: false,
			isOwner: false,
			orgIds: [],
		});
		expect(mockMembershipFindMany).not.toHaveBeenCalled();
	});

	it("queries only OWNER/ADMIN memberships, so a global ADMIN with an OPERATOR membership is denied", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([]);

		await expect(getTenantAdminState()).resolves.toMatchObject({ isAdmin: false });
		expect(mockMembershipFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					userId: "user-1",
					revokedAt: null,
					role: { in: ["OWNER", "ADMIN"] },
				}),
			}),
		);
	});

	it("denies an OWNER whose organization is suspended", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([{ orgId: "org-1", role: "OWNER" }] as never);
		mockOrganizationFindMany.mockResolvedValue([]);

		await expect(getTenantAdminState()).resolves.toMatchObject({ isAdmin: false });
	});

	it("allows an ADMIN of an active organization", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([{ orgId: "org-1", role: "ADMIN" }] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org-1" }] as never);

		await expect(getTenantAdminState()).resolves.toEqual({
			isAdmin: true,
			isOwner: false,
			orgIds: ["org-1"],
		});
	});

	it("marks an OWNER of an active organization as owner", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([{ orgId: "org-1", role: "OWNER" }] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org-1" }] as never);

		await expect(getTenantAdminState()).resolves.toEqual({
			isAdmin: true,
			isOwner: true,
			orgIds: ["org-1"],
		});
	});

	it("does not count an owner membership in a suspended org when another admin org is active", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([
			{ orgId: "org-suspended", role: "OWNER" },
			{ orgId: "org-active", role: "ADMIN" },
		] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org-active" }] as never);

		await expect(getTenantAdminState()).resolves.toEqual({
			isAdmin: true,
			isOwner: false,
			orgIds: ["org-active"],
		});
	});
});

describe("requireTenantAdmin", () => {
	it("redirects to the dashboard when the caller is not a tenant admin", async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		await requireTenantAdmin();

		expect(mockRedirect).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
	});

	it("does not redirect an active tenant admin", async () => {
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as never);
		mockMembershipFindMany.mockResolvedValue([{ orgId: "org-1", role: "OWNER" }] as never);
		mockOrganizationFindMany.mockResolvedValue([{ id: "org-1" }] as never);

		await requireTenantAdmin();

		expect(mockAssertPasswordChanged).toHaveBeenCalled();
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("rejects a tenant admin who still has a temporary password", async () => {
		mockAssertPasswordChanged.mockRejectedValueOnce(new Error("Password change required"));

		await expect(requireTenantAdmin()).rejects.toThrow("Password change required");
		expect(mockMembershipFindMany).not.toHaveBeenCalled();
	});
});
