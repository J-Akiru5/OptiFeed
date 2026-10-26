import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx, authAdmin } = vi.hoisted(() => {
	const tx = {
		user: { create: vi.fn() },
		organization: { create: vi.fn() },
		membership: { create: vi.fn() },
		farm: { create: vi.fn() },
		pond: { create: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		user: { findFirst: vi.fn(), findUnique: vi.fn() },
		organization: { findUnique: vi.fn() },
		$transaction: vi.fn(),
	};
	const authAdmin = { createUser: vi.fn(), deleteUser: vi.fn() };
	return { db, tx, authAdmin };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: authAdmin } }),
}));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	buildPondEmail: vi.fn((farmId: string) => `${farmId}@ponds.optifeed.test`),
}));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(),
	isStepUpRequiredError: vi.fn(() => false),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({
				"x-forwarded-for": "198.51.100.4, 10.0.0.1",
				"user-agent": "vitest-superadmin-audit",
			}),
	),
}));

import { createOrg, createPlatformUser } from "@/lib/actions/superadmin";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);

const REASON = "Operator request reviewed by the platform team";

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("platform audit targeting", () => {
	it("records an organization target with its orgId, IP and user agent", async () => {
		tx.organization.create.mockResolvedValue({
			id: "org-new",
			name: "New Coop",
			type: "COOPERATIVE",
		});

		const result = await createOrg({
			name: "New Coop",
			type: "COOPERATIVE",
			reason: REASON,
		});

		expect(result).toEqual({ success: true, orgId: "org-new" });
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			actorUserId: "admin-1",
			action: "platform.org.create",
			targetType: "organization",
			targetId: "org-new",
			orgId: "org-new",
			reason: REASON,
			ip: "198.51.100.4",
			userAgent: "vitest-superadmin-audit",
		});
	});

	it("records a user target with the org the account was created in", async () => {
		db.user.findFirst.mockResolvedValue(null);
		db.organization.findUnique.mockResolvedValue({ id: "org-a" });
		authAdmin.createUser.mockResolvedValue({
			data: { user: { id: "sb-new" } },
			error: null,
		});
		tx.user.create.mockResolvedValue({ id: "user-new", farmId: "farm-new" });
		tx.membership.create.mockResolvedValue({});

		const result = await createPlatformUser({
			reason: REASON,
			farmId: "farm-new",
			displayName: "Nena Cruz",
			password: "temp1234",
			kind: "ADMIN",
			orgId: "org-a",
		});

		expect(result).toEqual({ success: true, userId: "user-new" });
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			action: "platform.user.create",
			targetType: "user",
			targetId: "user-new",
			orgId: "org-a",
			reason: REASON,
			ip: "198.51.100.4",
			userAgent: "vitest-superadmin-audit",
			after: { farmId: "farm-new", kind: "ADMIN", role: "ADMIN", orgId: "org-a" },
		});
	});
});
