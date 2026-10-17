import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		pond: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
}));

import { EMPTY_SCOPE, resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const mockMembershipFindMany = vi.mocked(prisma.membership.findMany);
const mockUserFindMany = vi.mocked(prisma.user.findMany);
const mockPondFindMany = vi.mocked(prisma.pond.findMany);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

const USER = { id: "user_1", farmId: "farm-1" };

describe("resolveOrgScope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetCurrentUser.mockResolvedValue(USER as never);
	});

	it("returns EMPTY_SCOPE with no session", async () => {
		mockGetCurrentUser.mockResolvedValue(null);

		expect(await resolveOrgScope()).toEqual(EMPTY_SCOPE);
		expect(mockMembershipFindMany).not.toHaveBeenCalled();
	});

	it("returns EMPTY_SCOPE when the user has no OWNER/ADMIN membership", async () => {
		mockMembershipFindMany.mockResolvedValueOnce([] as never);

		expect(await resolveOrgScope()).toEqual(EMPTY_SCOPE);
		// Only the first (role-filtered) lookup ran — fail closed early.
		expect(mockMembershipFindMany).toHaveBeenCalledTimes(1);
		expect(mockMembershipFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ role: { in: ["OWNER", "ADMIN"] } }),
			}),
		);
	});

	it("ignores a revoked admin membership", async () => {
		mockMembershipFindMany.mockResolvedValueOnce([] as never);

		expect(await resolveOrgScope()).toEqual(EMPTY_SCOPE);
		expect(mockMembershipFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ revokedAt: null }),
			}),
		);
	});

	it("resolves members, farms and ponds for an active OWNER", async () => {
		mockMembershipFindMany
			.mockResolvedValueOnce([{ orgId: "org_1" }] as never) // admin memberships
			.mockResolvedValueOnce([{ userId: "user_1" }, { userId: "user_2" }] as never); // all org members
		mockUserFindMany.mockResolvedValue([{ farmId: "farm-1" }, { farmId: "farm-2" }] as never);
		mockPondFindMany.mockResolvedValue([{ id: "pond_1" }, { id: "pond_2" }] as never);

		expect(await resolveOrgScope()).toEqual({
			orgIds: ["org_1"],
			memberUserIds: ["user_1", "user_2"],
			farmIds: ["farm-1", "farm-2"],
			pondIds: ["pond_1", "pond_2"],
		});
	});

	it("deduplicates overlapping orgs", async () => {
		mockMembershipFindMany
			.mockResolvedValueOnce([{ orgId: "org_1" }, { orgId: "org_1" }] as never)
			.mockResolvedValueOnce([{ userId: "user_1" }] as never);
		mockUserFindMany.mockResolvedValue([{ farmId: "farm-1" }] as never);
		mockPondFindMany.mockResolvedValue([{ id: "pond_1" }] as never);

		const scope = await resolveOrgScope();

		expect(scope.orgIds).toEqual(["org_1"]);
		expect(scope.memberUserIds).toEqual(["user_1"]);
		expect(scope.farmIds).toEqual(["farm-1"]);
	});

	it("keeps orgIds and memberUserIds when members have no farms", async () => {
		mockMembershipFindMany
			.mockResolvedValueOnce([{ orgId: "org_1" }] as never)
			.mockResolvedValueOnce([{ userId: "user_1" }] as never);
		mockUserFindMany.mockResolvedValue([{ farmId: "farm-1" }] as never);
		mockPondFindMany.mockResolvedValue([] as never);

		const scope = await resolveOrgScope();

		expect(scope.orgIds).toEqual(["org_1"]);
		expect(scope.memberUserIds).toEqual(["user_1"]);
		expect(scope.farmIds).toEqual(["farm-1"]);
		expect(scope.pondIds).toEqual([]);
	});
});
