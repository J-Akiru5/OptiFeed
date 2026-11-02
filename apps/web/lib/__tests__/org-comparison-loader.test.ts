import type { Prisma } from "@prisma/client";
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
} = vi.hoisted(() => ({
	orgFindMany: vi.fn(),
	membershipFindMany: vi.fn(),
	userFindMany: vi.fn(),
	pondFindMany: vi.fn(),
	deviceFindMany: vi.fn(),
	notificationFindMany: vi.fn(),
	policyMock: vi.fn(),
	gateMock: vi.fn(),
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
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { deviceStatusPolicyFromValue } from "../device-status";
import { getOrgComparison } from "../platform/org-comparison";
import { TENANT_HEALTH_ORG_LIMIT } from "../platform/tenant-health";

/**
 * Organization comparison loader (issue #479, M3C.9).
 *
 * The fixtures below are typed from the generated Prisma client rather than
 * hand-shaped objects: `Prisma.*GetPayload<{select: …}>` is exactly the row each
 * read returns, so a schema or select change breaks this file at compile time
 * instead of quietly making the test assert against invented shapes. There is no
 * test database in this repo (no testcontainers, no pg-mem, no `test:db`), so
 * this is the closest the loader can get to real rows here.
 *
 * The suite covers the read path (bounded queries, one shared dataset), the
 * composition edges (worst first, unknown never healthy) and the failure paths.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MINUTE = 60 * 1000;
const POLICY = deviceStatusPolicyFromValue({ weakAfterMin: 4, offlineAfterMin: 5, graceMin: 0 });

function ago(minutes: number) {
	return new Date(NOW.getTime() - minutes * MINUTE);
}

type OrgRow = Prisma.OrganizationGetPayload<{
	select: { id: true; name: true; status: true };
}>;
type MembershipRow = Prisma.MembershipGetPayload<{ select: { orgId: true; userId: true } }>;
type UserRow = Prisma.UserGetPayload<{ select: { id: true; farmId: true } }>;
type PondRow = Prisma.PondGetPayload<{ select: { id: true; ownerId: true } }>;
type DeviceRow = Prisma.EnergyDeviceGetPayload<{
	select: { id: true; pondId: true; lastSeenAt: true };
}>;
type NotificationRow = Prisma.NotificationGetPayload<{ select: { pondId: true } }>;

const ORGS: OrgRow[] = [
	{ id: "org-alpha", name: "Alpha Farm", status: "ACTIVE" },
	{ id: "org-beta", name: "Beta Farm", status: "ACTIVE" },
	{ id: "org-gamma", name: "Gamma Farm", status: "ACTIVE" },
	{ id: "org-suspended", name: "Suspended Farm", status: "SUSPENDED" },
];

const MEMBERSHIPS: MembershipRow[] = [
	{ orgId: "org-alpha", userId: "user-alpha" },
	{ orgId: "org-beta", userId: "user-beta" },
	{ orgId: "org-gamma", userId: "user-gamma" },
	{ orgId: "org-suspended", userId: "user-suspended" },
];

const USERS: UserRow[] = [
	{ id: "user-alpha", farmId: "farm-alpha" },
	{ id: "user-beta", farmId: "farm-beta" },
	{ id: "user-gamma", farmId: "farm-gamma" },
	{ id: "user-suspended", farmId: "farm-suspended" },
];

// Gamma has no pond at all: nothing to measure, so it must read unknown.
const PONDS: PondRow[] = [
	{ id: "pond-alpha", ownerId: "farm-alpha" },
	{ id: "pond-beta", ownerId: "farm-beta" },
	{ id: "pond-suspended", ownerId: "farm-suspended" },
];

const DEVICES: DeviceRow[] = [
	{ id: "device-alpha-1", pondId: "pond-alpha", lastSeenAt: ago(1) },
	{ id: "device-beta-1", pondId: "pond-beta", lastSeenAt: ago(120) },
	{ id: "device-beta-2", pondId: "pond-beta", lastSeenAt: ago(180) },
	{ id: "device-suspended-1", pondId: "pond-suspended", lastSeenAt: ago(1) },
];

const ALERTS: NotificationRow[] = [
	{ pondId: "pond-alpha" },
	{ pondId: "pond-alpha" },
	{ pondId: "pond-beta" },
];

beforeEach(() => {
	vi.clearAllMocks();
	gateMock.mockResolvedValue(undefined);
	policyMock.mockResolvedValue(POLICY);
	orgFindMany.mockResolvedValue(ORGS);
	membershipFindMany.mockResolvedValue(MEMBERSHIPS);
	userFindMany.mockResolvedValue(USERS);
	pondFindMany.mockResolvedValue(PONDS);
	deviceFindMany.mockResolvedValue(DEVICES);
	notificationFindMany.mockResolvedValue(ALERTS);
});

describe("getOrgComparison", () => {
	it("compares the selected organizations worst first on the tenant table's scale", async () => {
		const page = await getOrgComparison(["org-alpha", "org-beta"], NOW);

		expect(page.sourceError).toBe(false);
		expect(page.comparison.rows.map((row) => row.orgId)).toEqual(["org-beta", "org-alpha"]);
		expect(page.comparison.state).toBe("critical");
		expect(page.comparison.rows[0]).toMatchObject({
			orgName: "Beta Farm",
			devices: 2,
			offlinePct: 100,
			openAlerts: 1,
		});
		expect(page.comparison.rows[1].orgName).toBe("Alpha Farm");
		expect(page.comparison.rows[1].offlinePct).toBe(0);
	});

	it("offers every organization as an option, worst first", async () => {
		const page = await getOrgComparison(undefined, NOW);

		expect(page.available).toBe(4);
		expect(page.options.map((option) => option.orgId)).toEqual([
			"org-beta",
			"org-suspended",
			"org-gamma",
			"org-alpha",
		]);
	});

	it("reads as unknown when an organization has nothing to measure", async () => {
		const page = await getOrgComparison(["org-gamma", "org-alpha"], NOW);
		const gamma = page.comparison.rows.find((row) => row.orgId === "org-gamma");

		expect(gamma?.state).toBe("unknown");
		expect(gamma?.offlinePct).toBeNull();
		expect(page.comparison.unknownOrgIds).toEqual(["org-gamma"]);
		// Nothing measured means no winner, never a default win for the empty tenant.
		expect(page.comparison.metrics.find((metric) => metric.key === "offlinePct")).toMatchObject({
			measured: 1,
			bestOrgIds: ["org-alpha"],
		});
	});

	it("reports ids that no longer exist instead of silently ignoring them", async () => {
		const page = await getOrgComparison(["org-alpha", "org-deleted"], NOW);

		expect(page.selection.selected).toEqual(["org-alpha"]);
		expect(page.selection.droppedOrgIds).toEqual(["org-deleted"]);
		expect(page.comparison.missingOrgIds).toEqual([]);
	});

	it("de-duplicates a repeated id instead of comparing an organization with itself", async () => {
		const page = await getOrgComparison(["org-alpha", "org-alpha", "org-beta"], NOW);

		expect(page.selection.selected).toEqual(["org-alpha", "org-beta"]);
		expect(page.comparison.rows).toHaveLength(2);
	});

	it("keeps every read bounded", async () => {
		await getOrgComparison(["org-alpha"], NOW);

		expect(orgFindMany.mock.calls[0][0].take).toBe(TENANT_HEALTH_ORG_LIMIT + 1);
		expect(deviceFindMany.mock.calls[0][0].take).toBeGreaterThan(1);
		expect(notificationFindMany.mock.calls[0][0].where).toMatchObject({
			acknowledgedAt: null,
			autoCleared: false,
		});
	});

	it("renders an explicit error when a read throws", async () => {
		deviceFindMany.mockRejectedValue(new Error("db down"));

		const page = await getOrgComparison(["org-alpha", "org-beta"], NOW);

		expect(page.sourceError).toBe(true);
		expect(page.available).toBe(0);
		expect(page.options).toEqual([]);
		expect(page.comparison.rows).toEqual([]);
		expect(page.comparison.state).toBe("unknown");
	});

	it("reads every tenant as unknown when the status policy cannot be read", async () => {
		policyMock.mockRejectedValue(new Error("policy unreadable"));

		const page = await getOrgComparison(["org-alpha", "org-beta"], NOW);

		expect(page.sourceError).toBe(true);
		expect(page.policyAvailable).toBe(false);
		expect(page.comparison.rows).toEqual([]);
	});
});
