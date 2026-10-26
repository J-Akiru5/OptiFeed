import { beforeEach, describe, expect, it, vi } from "vitest";

// Two tenants share the fake device table. Org A has pond-a in scope; dev-b1
// sits on another org's pond. Each row carries a credential that must only
// ever leave the server through a successful reveal, never through the audit
// row, an error or a cross-org lookup.
const TOKEN_A = "tok_SECRET_reveal_do_not_log_0123456789";
const TOKEN_B = "tok_SECRET_other_org_do_not_log_9876543210";

const { db } = vi.hoisted(() => {
	const rows = [
		{
			id: "dev-a1",
			label: "Feeder 1",
			mac: "A4:CF:12:7E:3B:09",
			pondId: "pond-a",
			token: "tok_SECRET_reveal_do_not_log_0123456789",
		},
		{
			id: "dev-b1",
			label: "Other org feeder",
			mac: "11:22:33:44:55:66",
			pondId: "pond-b",
			token: "tok_SECRET_other_org_do_not_log_9876543210",
		},
	];
	type Args = {
		where: { id: string; pondId: { in: string[] } };
		select: Record<string, true>;
	};
	const findFirst = vi.fn(async (args: Args) => {
		const row = rows.find((r) => r.id === args.where.id && args.where.pondId.in.includes(r.pondId));
		if (!row) return null;
		return Object.fromEntries(
			Object.keys(args.select).map((key) => [key, row[key as keyof typeof row]]),
		);
	});

	const db = {
		energyDevice: { findFirst },
		deviceStateEvent: { create: vi.fn() },
		platformAdmin: { findFirst: vi.fn(), findMany: vi.fn() },
	};
	return { db };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/rate-limit", () => ({ checkDeviceTokenRevealRateLimit: vi.fn() }));
vi.mock("@/lib/auth/tenant-admin", () => ({ requireTenantAdmin: vi.fn() }));
vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ buildPondEmail: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/password", () => ({
	passwordErrorMessage: vi.fn(),
	validatePassword: vi.fn(),
}));
vi.mock("@/lib/auth/permissions", () => ({
	ROLE_DEFAULTS: {},
	isPermission: vi.fn(),
	requirePermission: vi.fn(),
}));
vi.mock("@/lib/actions/admin-internal", () => ({ deleteUserSubtree: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

import { revealDeviceToken } from "@/lib/actions/admin";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentUser } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { checkDeviceTokenRevealRateLimit } from "@/lib/rate-limit";

const mockRequireTenantAdmin = vi.mocked(requireTenantAdmin);
const mockResolveOrgScope = vi.mocked(resolveOrgScope);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockRevealLimit = vi.mocked(checkDeviceTokenRevealRateLimit);

const orgAScope = {
	orgIds: ["org-a"],
	memberUserIds: ["u-a"],
	farmIds: ["f-a"],
	pondIds: ["pond-a"],
};

const ACTOR = { id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>;

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireTenantAdmin.mockResolvedValue(undefined);
	mockResolveOrgScope.mockResolvedValue(orgAScope);
	mockGetCurrentUser.mockResolvedValue(ACTOR);
	mockRevealLimit.mockResolvedValue({ success: true, remaining: 9 });
	db.deviceStateEvent.create.mockResolvedValue({});
});

describe("revealDeviceToken audit trail", () => {
	it("returns the in-scope token and writes one audit row without the token", async () => {
		const result = await revealDeviceToken("dev-a1");

		expect(result).toEqual({
			success: true,
			token: TOKEN_A,
			mac: "A4:CF:12:7E:3B:09",
			label: "Feeder 1",
		});

		expect(db.deviceStateEvent.create).toHaveBeenCalledTimes(1);
		const data = db.deviceStateEvent.create.mock.calls[0][0].data;
		expect(data).toMatchObject({
			deviceId: "dev-a1",
			eventType: "token_revealed",
			source: "user",
			actorId: "admin-1",
		});
		// The credential is the thing being audited; it must never be stored.
		expect(JSON.stringify(data)).not.toContain(TOKEN_A);
		expect(JSON.stringify(data)).not.toContain("SECRET");
	});

	it("writes exactly one row per reveal", async () => {
		await revealDeviceToken("dev-a1");
		await revealDeviceToken("dev-a1");

		expect(db.deviceStateEvent.create).toHaveBeenCalledTimes(2);
		for (const call of db.deviceStateEvent.create.mock.calls) {
			expect(call[0].data.eventType).toBe("token_revealed");
			expect(call[0].data.actorId).toBe("admin-1");
		}
	});

	it("does not return the token when the audit row cannot be written", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		db.deviceStateEvent.create.mockRejectedValue(new Error("insert failed"));

		const result = await revealDeviceToken("dev-a1");

		expect(result).toEqual({ success: false, error: "Failed to load the device token." });
		expect(JSON.stringify(result)).not.toContain(TOKEN_A);
		consoleError.mockRestore();
	});
});

describe("revealDeviceToken rate limit", () => {
	it("counts the reveal against the caller's hourly allowance", async () => {
		await revealDeviceToken("dev-a1");
		expect(mockRevealLimit).toHaveBeenCalledTimes(1);
		expect(mockRevealLimit).toHaveBeenCalledWith("admin-1");
	});

	it("returns a clear, typed error when the limit is exhausted", async () => {
		mockRevealLimit.mockResolvedValue({ success: false, remaining: 0 });

		const result = await revealDeviceToken("dev-a1");

		expect(result).toEqual({
			success: false,
			error: "Too many token reveals. Try again in an hour.",
			code: "rate_limited",
		});
		// Nothing is read or audited once the bucket is spent.
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.deviceStateEvent.create).not.toHaveBeenCalled();
	});
});

describe("revealDeviceToken tenant gate", () => {
	it("applies the tenant gate before the limiter or the database", async () => {
		mockRequireTenantAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(revealDeviceToken("dev-a1")).rejects.toThrow("NEXT_REDIRECT");
		expect(mockRevealLimit).not.toHaveBeenCalled();
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("treats a device from another org as not found and writes no audit row", async () => {
		const result = await revealDeviceToken("dev-b1");

		expect(result).toEqual({
			success: false,
			error: "Device not found in your organization.",
		});
		expect(JSON.stringify(result)).not.toContain(TOKEN_B);
		expect(db.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("scopes the lookup to the pond ids in the caller's org scope", async () => {
		await revealDeviceToken("dev-a1");
		expect(db.energyDevice.findFirst.mock.calls[0][0].where.pondId).toEqual({
			in: orgAScope.pondIds,
		});
	});
});
