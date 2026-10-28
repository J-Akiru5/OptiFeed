import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-a"],
		memberUserIds: ["user-a"],
		farmIds: ["farm-a"],
		pondIds: ["pond-a"],
	})),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: vi.fn(async () => []) },
		feedEvent: { findMany: vi.fn(async () => []) },
		deviceStateEvent: { findMany: vi.fn(async () => []) },
	},
}));

import { getAdminOverview } from "@/lib/actions/admin-overview";
import {
	ADMIN_ACTIVITY_DAYS,
	ADMIN_FEED_DAYS,
	buildActivityRows,
	buildDeviceHealth,
	buildFeedRows,
	farmDayKey,
	trimTruncatedDayKeys,
} from "@/lib/admin-overview";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import prisma from "@/lib/prisma";

describe("farmDayKey", () => {
	it("uses the Asia/Manila day at the UTC boundary", () => {
		expect(farmDayKey(new Date("2026-10-27T16:30:00.000Z"))).toBe("2026-10-28");
		expect(farmDayKey(new Date("2026-10-27T15:59:59.999Z"))).toBe("2026-10-27");
	});
});

describe("buildDeviceHealth", () => {
	const now = new Date("2026-10-28T12:00:00.000Z");

	it("counts a heartbeat exactly at the offline threshold as online", () => {
		const health = buildDeviceHealth(
			[
				{
					lastSeenAt: new Date(now.getTime() - OFFLINE_THRESHOLD_MS),
					approvalStatus: "APPROVED",
					isPaused: false,
				},
				{
					lastSeenAt: new Date(now.getTime() - OFFLINE_THRESHOLD_MS - 1),
					approvalStatus: "APPROVED",
					isPaused: false,
				},
				{ lastSeenAt: null, approvalStatus: "PENDING", isPaused: false },
			],
			now,
		);
		expect(health).toEqual({ online: 1, offline: 1, pending: 1, paused: 0, total: 3 });
	});

	it("counts a paused device in paused as well as its connection state", () => {
		const health = buildDeviceHealth(
			[{ lastSeenAt: now, approvalStatus: "APPROVED", isPaused: true }],
			now,
		);
		expect(health).toMatchObject({ online: 1, offline: 0, paused: 1, total: 1 });
	});
});

describe("buildFeedRows", () => {
	it("buckets every event into the farm day and keeps its source", () => {
		const rows = buildFeedRows([
			{ grams: 120, source: "scheduled", receivedAt: new Date("2026-10-27T16:30:00.000Z") },
			{ grams: 30, source: "button", receivedAt: new Date("2026-10-27T17:00:00.000Z") },
			{ grams: null, source: null, receivedAt: new Date("2026-10-27T15:00:00.000Z") },
		]);
		expect(rows).toEqual([
			{ label: "2026-10-28", source: "scheduled", count: 1, grams: 120 },
			{ label: "2026-10-28", source: "button", count: 1, grams: 30 },
			{ label: "2026-10-27", source: "unknown", count: 1, grams: 0 },
		]);
	});
});

describe("buildActivityRows", () => {
	it("counts one point per farm day", () => {
		expect(
			buildActivityRows([
				{ createdAt: new Date("2026-10-27T16:30:00.000Z") },
				{ createdAt: new Date("2026-10-27T17:30:00.000Z") },
			]),
		).toEqual([
			{ label: "2026-10-28", value: 1 },
			{ label: "2026-10-28", value: 1 },
		]);
	});
});

describe("trimTruncatedDayKeys", () => {
	const keys = ["2026-10-01", "2026-10-02", "2026-10-03"];

	it("keeps the full window when the query was complete", () => {
		expect(trimTruncatedDayKeys(keys, new Date("2026-10-03T01:00:00.000Z"), false)).toEqual(keys);
	});

	it("drops days older than the oldest fetched event when truncated", () => {
		expect(trimTruncatedDayKeys(keys, new Date("2026-10-02T01:00:00.000Z"), true)).toEqual([
			"2026-10-02",
			"2026-10-03",
		]);
	});

	it("returns the full window when there is no oldest event", () => {
		expect(trimTruncatedDayKeys(keys, null, true)).toEqual(keys);
	});
});

describe("getAdminOverview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireTenantAdmin).mockResolvedValue(undefined);
		vi.mocked(resolveOrgScope).mockResolvedValue({
			orgIds: ["org-a"],
			memberUserIds: ["user-a"],
			farmIds: ["farm-a"],
			pondIds: ["pond-a"],
		} as never);
	});

	it("scopes every read to the caller's ponds", async () => {
		const overview = await getAdminOverview();

		expect(prisma.energyDevice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { pondId: { in: ["pond-a"] } } }),
		);
		expect(prisma.feedEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ device: { pondId: { in: ["pond-a"] } } }),
			}),
		);
		expect(prisma.deviceStateEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ device: { pondId: { in: ["pond-a"] } } }),
			}),
		);
		expect(overview.feedDays).toBe(ADMIN_FEED_DAYS);
		expect(overview.activityDays).toBe(ADMIN_ACTIVITY_DAYS);
		expect(overview.feedTruncated).toBe(false);
		expect(overview.activityTruncated).toBe(false);
	});

	it("returns an empty overview without querying when the tenant has no ponds", async () => {
		vi.mocked(resolveOrgScope).mockResolvedValueOnce({
			orgIds: ["org-a"],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		} as never);

		const overview = await getAdminOverview();

		expect(overview.deviceHealth.total).toBe(0);
		expect(overview.feedStack.rows).toEqual([]);
		expect(overview.activityPoints).toEqual([]);
		expect(prisma.feedEvent.findMany).not.toHaveBeenCalled();
	});

	it("refuses a caller who is not a tenant admin", async () => {
		vi.mocked(requireTenantAdmin).mockRejectedValueOnce(new Error("not allowed"));

		await expect(getAdminOverview()).rejects.toThrow("not allowed");
	});
});
