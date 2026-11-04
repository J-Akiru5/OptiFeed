import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #765: revocation is an organization-access change, not an account deletion.
 *
 * The post-revocation account still has a membership row, so the write gate
 * must deny it; both org scopes must be empty; but the dashboard's own-farm
 * pond list must keep working from `User.farmId`.
 */
const holder = vi.hoisted(() => ({
	user: null as { id: string; farmId: string; role: string } | null,
	ownPonds: [] as Array<{ id: string; name: string; ownerId: string; status: string }>,
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn(async () => []) },
		organization: { findMany: vi.fn(async () => []) },
		user: { findMany: vi.fn(async () => []) },
		pond: { findMany: vi.fn(async () => holder.ownPonds) },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => holder.user),
	getCurrentPondOwnerIdSafe: vi.fn(async () => holder.user?.farmId ?? null),
	getCurrentPondOwnerId: vi.fn(async () => holder.user?.farmId ?? ""),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: vi.fn(() => undefined),
		set: vi.fn(),
	})),
}));

import { EMPTY_SCOPE, resolveMemberOrgScope, resolveOrgScope } from "@/lib/auth/org-scope";
import { resolveWriteAuthority } from "@/lib/auth/write-access";
import { listSelectablePonds } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";

beforeEach(() => {
	vi.clearAllMocks();
	holder.user = {
		id: "user-revoked",
		farmId: "farm-own",
		role: "OPERATOR", // the legacy role is deliberately still permissive
	};
	holder.ownPonds = [{ id: "pond-own", name: "Own Pond", ownerId: "farm-own", status: "ACTIVE" }];
});

describe("membership revocation semantics (#765)", () => {
	it("removes org scope and write authority but keeps the member's own farm readable", async () => {
		// The mocked membership query returns [] because the only membership has
		// revokedAt set; this is the post-revocation read path.
		expect(await resolveOrgScope()).toEqual(EMPTY_SCOPE);
		expect(await resolveMemberOrgScope()).toEqual(EMPTY_SCOPE);

		expect(
			resolveWriteAuthority({
				legacyRole: "OPERATOR",
				activeMembershipRoles: [],
				hasAnyMembership: true,
			}),
		).toEqual({ allowed: false, source: "none" });

		const ponds = await listSelectablePonds();

		expect(ponds.map((pond) => ({ id: pond.id, name: pond.name }))).toEqual([
			{ id: "pond-own", name: "Own Pond" },
		]);
		expect(vi.mocked(prisma.pond.findMany)).toHaveBeenCalledWith({
			where: { ownerId: "farm-own", status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
		});
	});
});
