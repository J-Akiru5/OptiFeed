import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findMany: vi.fn(),
		},
		deviceStateEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		pond: {
			findMany: vi.fn(),
		},
		user: {
			findMany: vi.fn(),
		},
		membership: {
			findMany: vi.fn(),
		},
		organization: {
			findMany: vi.fn(),
		},
		orgSetting: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
		},
		$transaction: vi.fn(async (input: unknown) => {
			if (Array.isArray(input)) return Promise.all(input);
			return (input as () => Promise<unknown>)();
		}),
	},
}));

vi.mock("@/lib/retention", () => ({
	deleteOldHeartbeatEvents: vi.fn().mockResolvedValue(3),
	deleteExpiredPondSettingsDrafts: vi.fn().mockResolvedValue(2),
}));

vi.mock("@/lib/error-capture", () => ({
	deleteExpiredErrorEvents: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/rate-limit", () => ({
	cleanupExpiredRateLimitBuckets: vi.fn().mockResolvedValue(7),
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/settings/device-status", () => ({
	getDeviceStatusPolicy: vi.fn(),
}));

import { GET } from "@/app/api/cron/device-watch/route";
import {
	DEFAULT_DEVICE_STATUS_POLICY,
	DEVICE_OFFLINE_AFTER_MIN_MIN,
	deviceStatusPolicyFromValue,
} from "@/lib/device-status";
import { deleteExpiredErrorEvents } from "@/lib/error-capture";
import prisma from "@/lib/prisma";
import { cleanupExpiredRateLimitBuckets } from "@/lib/rate-limit";
import { deleteExpiredPondSettingsDrafts, deleteOldHeartbeatEvents } from "@/lib/retention";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);

const STALE_DEVICE = {
	id: "dev-1",
	pondId: "pond-1",
	label: "Feeder A",
	// The platform policy decides when the alert fires (I-97): the default is a
	// 15-minute offline window plus 2 minutes of grace, so 31 minutes is stale.
	lastSeenAt: new Date(Date.now() - 31 * 60 * 1000),
};

const POND = {
	id: "pond-1",
	ownerId: "farm-a",
	notificationPrefs: {} as Record<string, unknown>,
};

function cronRequest(authorization?: string): Request {
	return new Request("http://test.local/api/cron/device-watch", {
		method: "GET",
		headers: authorization ? { authorization } : {},
	});
}

describe("api/cron/device-watch", () => {
	beforeEach(() => {
		vi.stubEnv("CRON_SECRET", "test-cron-secret");
		vi.clearAllMocks();
		mockEnergyDevice.findMany.mockResolvedValue([STALE_DEVICE] as never);
		mockDeviceStateEvent.findFirst.mockResolvedValue(null as never);
		mockDeviceStateEvent.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
		vi.mocked(prisma.pond.findMany).mockResolvedValue([{ ...POND }] as never);
		vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.membership.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.organization.findMany).mockResolvedValue([] as never);
		vi.mocked(prisma.orgSetting.findMany).mockResolvedValue([] as never);
		vi.mocked(getDeviceStatusPolicy).mockResolvedValue(DEFAULT_DEVICE_STATUS_POLICY);
		vi.mocked(deleteOldHeartbeatEvents).mockResolvedValue(3);
		vi.mocked(cleanupExpiredRateLimitBuckets).mockResolvedValue(7);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns 401 without an Authorization header", async () => {
		const res = await GET(cronRequest());
		expect(res.status).toBe(401);
		expect(mockEnergyDevice.findMany).not.toHaveBeenCalled();
	});

	it("returns 401 for a non-Bearer scheme", async () => {
		const res = await GET(cronRequest("Basic dGVzdA=="));
		expect(res.status).toBe(401);
	});

	it("returns 403 for the wrong secret", async () => {
		const res = await GET(cronRequest("Bearer wrong-secret"));
		expect(res.status).toBe(403);
		expect(mockEnergyDevice.findMany).not.toHaveBeenCalled();
	});

	it("returns 403 when CRON_SECRET is not configured", async () => {
		vi.stubEnv("CRON_SECRET", undefined);
		const res = await GET(cronRequest("Bearer anything"));
		expect(res.status).toBe(403);
		expect(mockEnergyDevice.findMany).not.toHaveBeenCalled();
	});

	it("alerts on a stale device exactly once — no repeat on later runs", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValueOnce(null as never);

		const first = await GET(cronRequest("Bearer test-cron-secret"));
		expect(first.status).toBe(200);
		await expect(first.json()).resolves.toMatchObject({
			data: {
				offlineAlerts: 1,
				heartbeatsDeleted: 3,
				bucketsDeleted: 7,
			},
		});

		expect(mockDeviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				pondId: "pond-1",
				tier: "CRITICAL",
				category: "connectivity",
			}),
		});

		// The alert is in-app only (ADR-0007): one Notification row on the first
		// detection, none on the repeat.

		// Second run: the disconnected event now exists after lastSeenAt.
		mockDeviceStateEvent.findFirst.mockResolvedValue({ id: "evt-1" } as never);
		const second = await GET(cronRequest("Bearer test-cron-secret"));
		expect(second.status).toBe(200);
		await expect(second.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });

		expect(mockDeviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
	});

	it("skips devices that are offline but already have a newer disconnected event", async () => {
		mockDeviceStateEvent.findFirst.mockResolvedValue({ id: "evt-existing" } as never);
		const res = await GET(cronRequest("Bearer test-cron-secret"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });
		expect(mockDeviceStateEvent.create).not.toHaveBeenCalled();
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("runs heartbeat retention and rate-limit cleanup each pass", async () => {
		await GET(cronRequest("Bearer test-cron-secret"));
		expect(deleteOldHeartbeatEvents).toHaveBeenCalledTimes(1);
		expect(cleanupExpiredRateLimitBuckets).toHaveBeenCalledTimes(1);
		// I-64: the 30-day ErrorEvent retention rides the same housekeeping pass.
		expect(deleteExpiredErrorEvents).toHaveBeenCalledTimes(1);
		// I-99: expired pond-settings drafts are pruned in the same pass.
		expect(deleteExpiredPondSettingsDrafts).toHaveBeenCalledTimes(1);
	});

	it("scans the most recently stale devices first, so an already-alerted device cannot starve new outages", async () => {
		// A device that has alerted stays stale forever. With an oldest-first
		// batch, 100 already-alerted devices permanently occupied the 100-row
		// window and no newly-offline device ever survived the scan.
		await GET(cronRequest("Bearer test-cron-secret"));

		expect(mockEnergyDevice.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				orderBy: { lastSeenAt: "desc" },
				take: 100,
			}),
		);
	});

	it("waits for the platform offline window before alerting (default five minutes)", async () => {
		mockEnergyDevice.findMany.mockResolvedValue([
			{ ...STALE_DEVICE, lastSeenAt: new Date(Date.now() - 4 * 60 * 1000) },
		] as never);

		const res = await GET(cronRequest("Bearer test-cron-secret"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("scans from the smallest allowed window so a short policy is seen", async () => {
		await GET(cronRequest("Bearer test-cron-secret"));

		const scan = mockEnergyDevice.findMany.mock.calls[0]?.[0] as {
			where: { lastSeenAt: { lt: Date } };
		};
		const ageMs = Date.now() - scan.where.lastSeenAt.lt.getTime();
		// 5 minutes (the minimum offline window) with no grace added.
		expect(ageMs).toBeGreaterThanOrEqual(DEVICE_OFFLINE_AFTER_MIN_MIN * 60 * 1000 - 2000);
		expect(ageMs).toBeLessThan(DEVICE_OFFLINE_AFTER_MIN_MIN * 60 * 1000 + 5000);
	});

	it("uses the platform policy, not the org offlineAfterMin", async () => {
		// A short platform policy (5 min + no grace) alerts a 6-minute outage even
		// though the org still stores a 90-minute value.
		vi.mocked(getDeviceStatusPolicy).mockResolvedValue(
			deviceStatusPolicyFromValue({ weakAfterMin: 2, offlineAfterMin: 5, graceMin: 0 }),
		);
		vi.mocked(prisma.pond.findMany).mockResolvedValue([{ ...POND, ownerId: "farm-user" }] as never);
		vi.mocked(prisma.user.findMany).mockResolvedValue([
			{ id: "user-1", farmId: "farm-user" },
		] as never);
		vi.mocked(prisma.membership.findMany).mockResolvedValue([
			{ userId: "user-1", orgId: "org-1", role: "OWNER" },
		] as never);
		vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never);
		vi.mocked(prisma.orgSetting.findMany).mockResolvedValue([
			{ orgId: "org-1", offlineAfterMin: 90 },
		] as never);
		mockEnergyDevice.findMany.mockResolvedValue([
			{ ...STALE_DEVICE, lastSeenAt: new Date(Date.now() - 6 * 60 * 1000) },
		] as never);

		const res = await GET(cronRequest("Bearer test-cron-secret"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ data: { offlineAlerts: 1 } });
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
	});

	it("ignores a short org delay: the platform policy alone decides", async () => {
		// The org wants an alert after five minutes, the platform policy waits
		// thirty, so six minutes of silence is not due yet (I-97).
		vi.mocked(getDeviceStatusPolicy).mockResolvedValue(
			deviceStatusPolicyFromValue({ weakAfterMin: 10, offlineAfterMin: 30, graceMin: 0 }),
		);
		vi.mocked(prisma.pond.findMany).mockResolvedValue([{ ...POND, ownerId: "farm-user" }] as never);
		vi.mocked(prisma.user.findMany).mockResolvedValue([
			{ id: "user-1", farmId: "farm-user" },
		] as never);
		vi.mocked(prisma.membership.findMany).mockResolvedValue([
			{ userId: "user-1", orgId: "org-1", role: "OWNER" },
		] as never);
		vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never);
		vi.mocked(prisma.orgSetting.findMany).mockResolvedValue([
			{ orgId: "org-1", offlineAfterMin: 5 },
		] as never);
		mockEnergyDevice.findMany.mockResolvedValue([
			{ ...STALE_DEVICE, lastSeenAt: new Date(Date.now() - 6 * 60 * 1000) },
		] as never);

		const res = await GET(cronRequest("Bearer test-cron-secret"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("alerts after the display window, not inside it", async () => {
		const policyMs =
			DEFAULT_DEVICE_STATUS_POLICY.offlineAfterMs + DEFAULT_DEVICE_STATUS_POLICY.graceMs;

		// Five seconds inside the window (never due), then five seconds past it.
		mockEnergyDevice.findMany.mockResolvedValue([
			{ ...STALE_DEVICE, lastSeenAt: new Date(Date.now() - policyMs + 5000) },
		] as never);
		const inside = await GET(cronRequest("Bearer test-cron-secret"));
		await expect(inside.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });

		mockEnergyDevice.findMany.mockResolvedValue([
			{ ...STALE_DEVICE, lastSeenAt: new Date(Date.now() - policyMs - 5000) },
		] as never);
		const past = await GET(cronRequest("Bearer test-cron-secret"));
		await expect(past.json()).resolves.toMatchObject({ data: { offlineAlerts: 1 } });
	});

	it("respects the pond's deviceOffline preference", async () => {
		vi.mocked(prisma.pond.findMany).mockResolvedValue([
			{ ...POND, notificationPrefs: { deviceOffline: false } },
		] as never);

		const res = await GET(cronRequest("Bearer test-cron-secret"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ data: { offlineAlerts: 0 } });
		expect(mockNotification.create).not.toHaveBeenCalled();
	});
});
