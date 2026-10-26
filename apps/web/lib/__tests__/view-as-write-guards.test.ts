import { beforeEach, describe, expect, it, vi } from "vitest";

// Same identity setup as password-guard.test.ts.
vi.mock("@/lib/supabase/server", () => {
	const auth = { getUser: vi.fn(async () => ({ data: { user: null } })) };
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		membershipPermission: { findMany: vi.fn() },
	},
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

const viewAs = vi.hoisted(() => ({
	getViewAsState: vi.fn(),
	isViewingAs: vi.fn(),
	assertNotViewingAs: vi.fn(),
}));

vi.mock("@/lib/auth/view-as", () => viewAs);

import { requirePermission } from "@/lib/auth/permissions";
import { canWrite, getCurrentPondOwnerIdSafe, requireWriteAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

async function signIn(user: { id: string; email: string } | null) {
	const client = await createClient();
	client.auth.getUser = vi.fn(async () => ({ data: { user } })) as never;
}

const USER = {
	id: "user-1",
	farmId: "own-farm",
	supabaseId: "sb-1",
	role: "OPERATOR",
	mustChangePassword: false,
};

async function setUser(overrides: Partial<typeof USER> = {}) {
	await signIn({ id: "sb-1", email: "own-farm@pond.optifeed.local" });
	const prisma = (await import("@/lib/prisma")).default;
	vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...USER, ...overrides } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
	viewAs.isViewingAs.mockResolvedValue(false);
	viewAs.assertNotViewingAs.mockResolvedValue(undefined);
	viewAs.getViewAsState.mockResolvedValue({ active: false, reason: "missing" });
});

describe("writes are rejected during view-as", () => {
	it("requireWriteAccess fails closed with the shared read-only guard", async () => {
		await setUser();
		viewAs.assertNotViewingAs.mockRejectedValue(
			new Error("This is a read-only view-as session. Exit view-as to make changes."),
		);

		await expect(requireWriteAccess()).rejects.toThrow(/read-only view-as/i);
	});

	it("requirePermission fails closed before reading permissions", async () => {
		await setUser();
		viewAs.assertNotViewingAs.mockRejectedValue(
			new Error("This is a read-only view-as session. Exit view-as to make changes."),
		);
		const prisma = (await import("@/lib/prisma")).default;

		await expect(requirePermission("control_feeder")).rejects.toThrow(/read-only view-as/i);
		expect(prisma.membership.findMany).not.toHaveBeenCalled();
	});

	it("canWrite is false during view-as, so the dashboard disables controls", async () => {
		await setUser();
		viewAs.isViewingAs.mockResolvedValue(true);

		expect(await canWrite()).toBe(false);
	});

	it("getCurrentPondOwnerIdSafe resolves reads to the viewed tenant's farm", async () => {
		await setUser();
		viewAs.getViewAsState.mockResolvedValue({
			active: true,
			sessionId: "sess-1",
			actorUserId: "user-1",
			orgId: "org-a",
			farmId: "viewed-farm",
			reason: "Support call",
			expiresAt: new Date(),
		});

		await expect(getCurrentPondOwnerIdSafe()).resolves.toBe("viewed-farm");
	});

	it("keeps the admin's own farm when no view-as session is active", async () => {
		await setUser();

		await expect(getCurrentPondOwnerIdSafe()).resolves.toBe("own-farm");
	});

	it("still allows writes for an OPERATOR outside view-as", async () => {
		await setUser();

		await expect(requireWriteAccess()).resolves.toBeUndefined();
		expect(await canWrite()).toBe(true);
	});
});
