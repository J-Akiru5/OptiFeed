import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn() },
		organization: { count: vi.fn() },
		user: { findUnique: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
	},
}));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { redirect } from "@/i18n/routing";
import { redirectPlatformAdminFromDashboard } from "@/lib/auth/dashboard-landing";
import { getPostLoginDestination } from "@/lib/auth/post-login";
import { hasActiveTenantMembership } from "@/lib/auth/tenant-membership";
import prisma from "@/lib/prisma";

const findMemberships = vi.mocked(prisma.membership.findMany);
const countOrgs = vi.mocked(prisma.organization.count);
const findUser = vi.mocked(prisma.user.findUnique);
const findPlatformAdmin = vi.mocked(prisma.platformAdmin.findUnique);
const mockRedirect = vi.mocked(redirect);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("hasActiveTenantMembership", () => {
	it("accepts a membership in an active organization", async () => {
		findMemberships.mockResolvedValue([{ orgId: "org-1" }] as never);
		countOrgs.mockResolvedValue(1 as never);

		await expect(hasActiveTenantMembership("user-1")).resolves.toBe(true);
		expect(countOrgs).toHaveBeenCalledWith({
			where: { id: { in: ["org-1"] }, status: "ACTIVE" },
		});
	});

	it("rejects a user with no membership without querying organizations", async () => {
		findMemberships.mockResolvedValue([] as never);

		await expect(hasActiveTenantMembership("user-1")).resolves.toBe(false);
		expect(countOrgs).not.toHaveBeenCalled();
	});

	it("rejects a membership whose only organization is suspended", async () => {
		findMemberships.mockResolvedValue([{ orgId: "org-1" }] as never);
		countOrgs.mockResolvedValue(0 as never);

		await expect(hasActiveTenantMembership("user-1")).resolves.toBe(false);
	});
});

describe("redirectPlatformAdminFromDashboard (E18, #199)", () => {
	it("sends a platform admin outside view-as to the platform console", async () => {
		findMemberships.mockResolvedValue([] as never);

		await redirectPlatformAdminFromDashboard({
			isPlatformAdmin: true,
			viewAsActive: false,
			userId: "admin-1",
		});

		expect(mockRedirect).toHaveBeenCalledWith({ href: "/superadmin", locale: "en" });
	});

	it("never redirects during an active read-only view-as session", async () => {
		await redirectPlatformAdminFromDashboard({
			isPlatformAdmin: true,
			viewAsActive: true,
			userId: "admin-1",
		});

		expect(mockRedirect).not.toHaveBeenCalled();
		// The tenant dashboard renders exactly as it does for the tenant, so the
		// membership lookup is not even needed.
		expect(findMemberships).not.toHaveBeenCalled();
	});

	it("leaves a platform admin who is also a tenant member on their farm dashboard", async () => {
		findMemberships.mockResolvedValue([{ orgId: "org-1" }] as never);
		countOrgs.mockResolvedValue(1 as never);

		await redirectPlatformAdminFromDashboard({
			isPlatformAdmin: true,
			viewAsActive: false,
			userId: "admin-1",
		});

		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("leaves a normal farmer alone without a membership lookup", async () => {
		await redirectPlatformAdminFromDashboard({
			isPlatformAdmin: false,
			viewAsActive: false,
			userId: "farmer-1",
		});

		expect(mockRedirect).not.toHaveBeenCalled();
		expect(findMemberships).not.toHaveBeenCalled();
	});
});

describe("login landing (E18, #199)", () => {
	const FARMER = {
		id: "user-1",
		farmId: "juan",
		mustChangePassword: false,
	};

	it("lands an active platform admin on the platform console", async () => {
		findUser.mockResolvedValue(FARMER as never);
		findPlatformAdmin.mockResolvedValue({
			revokedAt: null,
			expiresAt: null,
		} as never);

		await expect(getPostLoginDestination("juan", "sb-1")).resolves.toBe("/superadmin");
	});

	it("still lands a normal farmer on the dashboard", async () => {
		findUser.mockResolvedValue(FARMER as never);
		findPlatformAdmin.mockResolvedValue(null);

		await expect(getPostLoginDestination("juan", "sb-1")).resolves.toBe("/dashboard");
	});

	it("keeps the password change ahead of the platform console", async () => {
		findUser.mockResolvedValue({ ...FARMER, mustChangePassword: true } as never);

		await expect(getPostLoginDestination("juan", "sb-1")).resolves.toBe("/change-password");
		expect(findPlatformAdmin).not.toHaveBeenCalled();
	});
});

describe("wiring", () => {
	const webRoot = join(__dirname, "../..");

	it("applies the guard from the tenant dashboard layout", () => {
		const layout = readFileSync(join(webRoot, "app/[locale]/(dashboard)/layout.tsx"), "utf8");

		expect(layout).toContain("redirectPlatformAdminFromDashboard(");
		// The guard must see the canonical view-as state, not the banner helper,
		// which also returns null when its organization lookup fails.
		expect(layout).toContain("getViewAsState()");
		expect(layout).toContain("viewAsActive: viewAsState.active");
	});

	it("offers the farm dashboard link only to a tenant member", () => {
		const layout = readFileSync(
			join(webRoot, "app/[locale]/(superadmin)/superadmin/layout.tsx"),
			"utf8",
		);

		expect(layout).toContain("hasActiveTenantMembership(user.id)");
		expect(layout).toContain("hasFarmDashboard &&");
		expect(layout).toContain('t("openFarmDashboard")');
	});
});
