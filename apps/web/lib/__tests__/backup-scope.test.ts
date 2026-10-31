import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveOrgScope: vi.fn(),
	membershipFindMany: vi.fn(),
	orgFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: mocks.resolveOrgScope }));
vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: mocks.membershipFindMany },
		organization: { findMany: mocks.orgFindMany },
	},
}));

import {
	EMPTY_TENANT_SCOPE,
	SCOPE_ID_LIMIT,
	isEmptyTenantScope,
	resolveTenantExportScope,
} from "@/lib/backup/scope";

/**
 * Tenant scope resolution. The export must use the same membership chain as the
 * console, fail closed, and never widen the id lists.
 */

beforeEach(() => {
	mocks.resolveOrgScope.mockReset();
	mocks.membershipFindMany.mockReset().mockResolvedValue([]);
	mocks.orgFindMany.mockReset().mockResolvedValue([]);
});

describe("resolveTenantExportScope", () => {
	it("returns an empty scope without further queries when the caller admins no organization", async () => {
		mocks.resolveOrgScope.mockResolvedValue(EMPTY_TENANT_SCOPE);

		const scope = await resolveTenantExportScope();

		expect(scope).toEqual(EMPTY_TENANT_SCOPE);
		expect(mocks.membershipFindMany).not.toHaveBeenCalled();
		expect(mocks.orgFindMany).not.toHaveBeenCalled();
	});

	it("carries the org, member, farm and pond ids from resolveOrgScope", async () => {
		mocks.resolveOrgScope.mockResolvedValue({
			orgIds: ["org-2", "org-1"],
			memberUserIds: ["user-1", "user-2"],
			farmIds: ["farm-1"],
			pondIds: ["pond-1", "pond-2"],
		});
		mocks.membershipFindMany.mockResolvedValue([{ id: "m-1" }, { id: "m-2" }]);
		mocks.orgFindMany.mockResolvedValue([
			{ id: "org-1", name: "Alpha" },
			{ id: "org-2", name: "Beta" },
		]);

		const scope = await resolveTenantExportScope();

		expect(scope.kind).toBe("tenant");
		expect(scope.orgIds).toEqual(["org-1", "org-2"]);
		expect(scope.orgNames).toEqual(["Alpha", "Beta"]);
		expect(scope.membershipIds).toEqual(["m-1", "m-2"]);
		expect(scope.memberUserIds).toEqual(["user-1", "user-2"]);
		expect(scope.farmIds).toEqual(["farm-1"]);
		expect(scope.pondIds).toEqual(["pond-1", "pond-2"]);
	});

	it("falls back to the id when an organization row has no name", async () => {
		mocks.resolveOrgScope.mockResolvedValue({
			orgIds: ["org-1"],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		});
		mocks.orgFindMany.mockResolvedValue([]);

		const scope = await resolveTenantExportScope();
		expect(scope.orgNames).toEqual(["org-1"]);
	});

	it("bounds the scope lookups", async () => {
		mocks.resolveOrgScope.mockResolvedValue({
			orgIds: ["org-1"],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		});

		await resolveTenantExportScope();

		expect(mocks.membershipFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: SCOPE_ID_LIMIT }),
		);
		expect(mocks.orgFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: SCOPE_ID_LIMIT }),
		);
	});
});

describe("isEmptyTenantScope", () => {
	it("is true only when there is no organization", () => {
		expect(isEmptyTenantScope(EMPTY_TENANT_SCOPE)).toBe(true);
		expect(
			isEmptyTenantScope({
				kind: "tenant",
				orgIds: ["org-1"],
				orgNames: [],
				memberUserIds: [],
				farmIds: [],
				pondIds: [],
				membershipIds: [],
			}),
		).toBe(false);
	});
});
