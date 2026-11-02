import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	orgFindMany,
	membershipFindMany,
	userFindMany,
	pondFindMany,
	deviceFindMany,
	notificationFindMany,
	policyMock,
	gateMock,
	pageSizeMock,
} = vi.hoisted(() => ({
	orgFindMany: vi.fn(),
	membershipFindMany: vi.fn(),
	userFindMany: vi.fn(),
	pondFindMany: vi.fn(),
	deviceFindMany: vi.fn(),
	notificationFindMany: vi.fn(),
	policyMock: vi.fn(),
	gateMock: vi.fn(),
	pageSizeMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		organization: { findMany: orgFindMany },
		membership: { findMany: membershipFindMany },
		user: { findMany: userFindMany },
		pond: { findMany: pondFindMany },
		energyDevice: { findMany: deviceFindMany },
		notification: { findMany: notificationFindMany },
	},
}));
vi.mock("@/lib/settings/device-status", () => ({ getDeviceStatusPolicy: policyMock }));
vi.mock("@/lib/settings/platform", () => ({ getListPageSize: pageSizeMock }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { deviceStatusPolicyFromValue } from "../device-status";
import { TENANT_HEALTH_DEVICE_LIMIT, getTenantHealth } from "../platform/tenant-health";

/**
 * Tenant health loader (issue #479, M3C.3).
 *
 * The rules tests cover ranking and paging; these cover the six bounded reads
 * that build a tenant row, the shared farm → organization attribution, and the
 * failure paths: a throwing source or an unreadable policy must arrive as an
 * explicit error state, never as a clean table.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

beforeEach(() => {
	vi.clearAllMocks();
	gateMock.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
	policyMock.mockResolvedValue(POLICY);
	pageSizeMock.mockResolvedValue(2);
	orgFindMany.mockResolvedValue([
		{ id: "org-a", name: "Alpha", status: "ACTIVE" },
		{ id: "org-b", name: "Beta", status: "ACTIVE" },
		{ id: "org-c", name: "Gamma", status: "SUSPENDED" },
	]);
	membershipFindMany.mockResolvedValue([
		{ orgId: "org-a", userId: "u-a" },
		{ orgId: "org-b", userId: "u-b" },
	]);
	userFindMany.mockResolvedValue([
		{ id: "u-a", farmId: "farm-a" },
		{ id: "u-b", farmId: "farm-b" },
	]);
	pondFindMany.mockResolvedValue([
		{ id: "pond-a", ownerId: "farm-a" },
		{ id: "pond-b", ownerId: "farm-b" },
	]);
	deviceFindMany.mockResolvedValue([
		{ id: "d1", pondId: "pond-a", lastSeenAt: ago(60) },
		{ id: "d2", pondId: "pond-a", lastSeenAt: ago(60) },
		{ id: "d3", pondId: "pond-b", lastSeenAt: ago(1) },
	]);
	notificationFindMany.mockResolvedValue([{ pondId: "pond-a" }]);
});

describe("getTenantHealth", () => {
	it("builds a row per tenant and pages them worst first", async () => {
		const page = await getTenantHealth(1, NOW);

		expect(page.sourceError).toBe(false);
		expect(page.policyAvailable).toBe(true);
		expect(page.totalTenants).toBe(3);
		expect(page.pagination).toMatchObject({ page: 1, pageSize: 2, pageCount: 2 });
		expect(page.rows).toHaveLength(2);

		// Alpha's two units are both silent → critical; Gamma is suspended but has
		// no pond, so it is unknown; Beta is healthy.
		expect(page.rows[0]?.orgName).toBe("Alpha");
		expect(page.rows[0]?.state).toBe("critical");
		expect(page.rows[0]?.offline).toBe(2);
		expect(page.rows[0]?.openAlerts).toBe(1);
		expect(page.summary.state).toBe("critical");
	});

	it("returns the second page and never sends an empty one for a stale page", async () => {
		// Alpha is critical, Gamma degraded (suspended), Beta ok — so page 2 is Beta.
		expect((await getTenantHealth(1, NOW)).rows.map((row) => row.orgName)).toEqual([
			"Alpha",
			"Gamma",
		]);
		const second = await getTenantHealth(2, NOW);
		expect(second.rows.map((row) => row.orgName)).toEqual(["Beta"]);

		const stale = await getTenantHealth(99, NOW);
		expect(stale.pagination.page).toBe(2);
		expect(stale.rows.length).toBeGreaterThan(0);
	});

	it("keeps a tenant with no ponds visible and unmeasured", async () => {
		orgFindMany.mockResolvedValue([{ id: "org-z", name: "Zeta", status: "ACTIVE" }]);
		membershipFindMany.mockResolvedValue([]);

		const page = await getTenantHealth(1, NOW);

		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]?.devices).toBe(0);
		expect(page.rows[0]?.state).toBe("unknown");
		expect(page.summary.state).not.toBe("ok");
	});

	it("reports a suspended tenant as degraded", async () => {
		orgFindMany.mockResolvedValue([{ id: "org-c", name: "Gamma", status: "SUSPENDED" }]);
		membershipFindMany.mockResolvedValue([{ orgId: "org-c", userId: "u-b" }]);
		userFindMany.mockResolvedValue([{ id: "u-b", farmId: "farm-b" }]);
		pondFindMany.mockResolvedValue([{ id: "pond-b", ownerId: "farm-b" }]);
		deviceFindMany.mockResolvedValue([{ id: "d3", pondId: "pond-b", lastSeenAt: ago(1) }]);

		const page = await getTenantHealth(1, NOW);

		expect(page.rows[0]?.deviceState).toBe("ok");
		expect(page.rows[0]?.state).toBe("degraded");
	});

	it("turns a throwing source into an explicit error state, not an empty table", async () => {
		orgFindMany.mockRejectedValue(new Error("db down"));

		const page = await getTenantHealth(1, NOW);

		expect(page.sourceError).toBe(true);
		expect(page.summary.state).toBe("unknown");
		expect(page.rows).toEqual([]);
		expect(page.policyAvailable).toBe(false);
	});

	it("treats an unreadable device policy as an error rather than guessing windows", async () => {
		policyMock.mockRejectedValue(new Error("setting unreadable"));

		const page = await getTenantHealth(1, NOW);

		expect(page.sourceError).toBe(true);
		expect(page.summary.state).toBe("unknown");
		expect(page.rows).toEqual([]);
	});

	it("says when the device read was cut at its cap", async () => {
		pageSizeMock.mockResolvedValue(10);
		deviceFindMany.mockResolvedValue(
			Array.from({ length: TENANT_HEALTH_DEVICE_LIMIT + 1 }, (_, index) => ({
				id: `d${index}`,
				pondId: "pond-a",
				lastSeenAt: ago(1),
			})),
		);

		const page = await getTenantHealth(1, NOW);

		expect(page.truncated).toBe(true);
		const alpha = page.rows.find((row) => row.orgName === "Alpha");
		expect(alpha?.reporting).toBe(TENANT_HEALTH_DEVICE_LIMIT);
		expect(alpha?.devices).toBe(TENANT_HEALTH_DEVICE_LIMIT);
	});

	it("gates the read on the platform-admin check", async () => {
		await getTenantHealth(1, NOW);
		expect(gateMock).toHaveBeenCalled();
	});
});
