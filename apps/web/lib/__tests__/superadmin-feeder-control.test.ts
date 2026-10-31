import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		feedRequest: {
			updateMany: vi.fn(),
			findFirst: vi.fn(),
			aggregate: vi.fn(),
			create: vi.fn(),
		},
		deviceStateEvent: { create: vi.fn(), findFirst: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		energyDevice: { findUnique: vi.fn() },
		organization: { findMany: vi.fn() },
		membership: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(new Date("2026-10-26T00:00:00.000Z")),
	),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () =>
			new Headers({ "x-forwarded-for": "10.0.0.99, 203.0.113.7", "user-agent": "vitest" }),
	),
}));

const STEP_UP_AT = new Date("2026-10-26T00:00:00.000Z");
const REASON = "Remote feed approved by the platform team";

import { remoteFeedDevice, remoteSetDevicePause } from "@/lib/actions/platform/devices";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);

const DEVICE_ID = "dev-1";

function allowDevice(overrides: { isPaused?: boolean; isFallow?: boolean } = {}) {
	db.energyDevice.findUnique.mockResolvedValue({
		id: DEVICE_ID,
		isPaused: overrides.isPaused ?? false,
		pond: { ownerId: "farm-a" },
	});
	tx.energyDevice.findFirst.mockResolvedValue({
		id: DEVICE_ID,
		gramsPerFeeding: 500,
		gramsPerSecond: 4,
		lastSeenAt: new Date(),
		hopperCapacityG: null,
		isPaused: overrides.isPaused ?? false,
		pond: { isFallow: overrides.isFallow ?? false },
	});
	// orgsForFarms: farm-a → user-a → org-a
	db.user.findMany.mockResolvedValue([{ id: "u-a", farmId: "farm-a" }]);
	db.membership.findMany.mockResolvedValue([{ userId: "u-a", orgId: "org-a" }]);
	db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

	tx.feedRequest.updateMany.mockResolvedValue({ count: 0 });
	tx.feedRequest.findFirst.mockResolvedValue(null);
	tx.feedRequest.aggregate.mockResolvedValue({ _sum: { grams: 0 } });
	tx.feedRequest.create.mockResolvedValue({ id: "req-1" });
	tx.deviceStateEvent.create.mockResolvedValue({});
	tx.deviceStateEvent.findFirst.mockResolvedValue(null);
	tx.energyDevice.update.mockResolvedValue({});
	tx.platformAuditLog.create.mockResolvedValue({});
}

function auditRows() {
	return tx.platformAuditLog.create.mock.calls.map((call) => call[0].data);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
});

describe("remoteFeedDevice", () => {
	it("denies a caller who is not a platform admin before any database work", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(
			remoteFeedDevice({ deviceId: DEVICE_ID, grams: 150, reason: REASON }),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("requires a reason of at least 10 characters", async () => {
		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 150, reason: "short" });
		expect(result).toEqual({ error: expect.stringContaining("reason") });
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});

	it("requires a fresh step-up and writes nothing without one", async () => {
		allowDevice();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Re-enter your password to continue."), {
				code: "step_up_required",
			}),
		);

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 150, reason: REASON });

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.feedRequest.create).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("refuses absurd input above the 5,000 g sanity bound, never a queued feed", async () => {
		allowDevice();

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 5001, reason: REASON });

		expect(result).toMatchObject({ success: false, code: "feed_refused" });
		expect(result).toHaveProperty("error", expect.stringContaining("5000"));
		expect(tx.feedRequest.create).not.toHaveBeenCalled();

		const row = auditRows()[0];
		expect(row).toMatchObject({
			action: "platform.device.feed_refused",
			targetType: "energy_device",
			targetId: DEVICE_ID,
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
		});
		expect(row.after).toMatchObject({ grams: 5001, code: "invalid_grams" });
	});

	it("enforces the daily cap through the shared tenant command path", async () => {
		allowDevice();
		tx.feedRequest.aggregate.mockResolvedValue({ _sum: { grams: 4950 } });

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 150, reason: REASON });

		expect(result).toMatchObject({ success: false, code: "feed_refused" });
		expect(result).toHaveProperty("error", expect.stringContaining("daily ceiling"));
		expect(tx.feedRequest.create).not.toHaveBeenCalled();
		expect(auditRows()).toHaveLength(1);
	});

	it("refuses an offline device (no silent queueing)", async () => {
		allowDevice();
		tx.energyDevice.findFirst.mockResolvedValue({
			id: DEVICE_ID,
			gramsPerFeeding: 150,
			gramsPerSecond: 4,
			lastSeenAt: null,
			hopperCapacityG: null,
			pond: { isFallow: false },
		});

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 150, reason: REASON });

		expect(result).toMatchObject({ code: "feed_refused" });
		expect(result).toHaveProperty("error", expect.stringContaining("offline"));
		expect(tx.feedRequest.create).not.toHaveBeenCalled();
	});

	it("has no force flag: an extra force property cannot bypass the limit", async () => {
		allowDevice();

		const result = await remoteFeedDevice({
			deviceId: DEVICE_ID,
			grams: 5001,
			reason: REASON,
			force: true,
		} as unknown as Parameters<typeof remoteFeedDevice>[0]);

		expect(result).toMatchObject({ code: "feed_refused" });
		expect(tx.feedRequest.create).not.toHaveBeenCalled();
	});

	it("queues a valid feed through the same FeedRequest write and audits one row with orgId", async () => {
		allowDevice();

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 200, reason: REASON });

		expect(result).toEqual({ success: true });
		expect(tx.feedRequest.create).toHaveBeenCalledWith({
			data: { deviceId: DEVICE_ID, grams: 200, status: "pending" },
		});
		expect(tx.deviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: DEVICE_ID,
				eventType: "manual_trigger",
				source: "user",
				actorId: "admin-1",
				metadata: { grams: 200, triggerSource: "platform_remote" },
			}),
		});

		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorUserId: "admin-1",
			action: "platform.device.feed",
			targetType: "energy_device",
			targetId: DEVICE_ID,
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			temporaryGrant: false,
			ip: "203.0.113.7",
			userAgent: "vitest",
		});
		expect(rows[0].after).toMatchObject({ grams: 200, requestId: "req-1" });
	});

	it("reports an already-pending feed without duplicating it", async () => {
		allowDevice();
		tx.feedRequest.findFirst.mockResolvedValueOnce({ id: "existing" });

		const result = await remoteFeedDevice({ deviceId: DEVICE_ID, grams: 200, reason: REASON });

		expect(result).toEqual({ success: true, message: "Feed already pending" });
		expect(tx.feedRequest.create).not.toHaveBeenCalled();
		expect(auditRows()).toHaveLength(1);
	});
});

describe("remoteSetDevicePause", () => {
	it("denies a caller who is not a platform admin", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(
			remoteSetDevicePause({ deviceId: DEVICE_ID, isPaused: true, reason: REASON }),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});

	it("requires a fresh step-up", async () => {
		allowDevice();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Your step-up check expired."), { code: "step_up_required" }),
		);

		const result = await remoteSetDevicePause({
			deviceId: DEVICE_ID,
			isPaused: true,
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("pauses the schedule with the same device write and audits one row with orgId", async () => {
		allowDevice();

		const result = await remoteSetDevicePause({
			deviceId: DEVICE_ID,
			isPaused: true,
			reason: REASON,
		});

		expect(result).toEqual({ success: true, isPaused: true });
		expect(tx.energyDevice.update).toHaveBeenCalledWith({
			where: { id: DEVICE_ID },
			data: { isPaused: true },
		});
		expect(tx.deviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ eventType: "pause_toggled", actorId: "admin-1" }),
		});

		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: "platform.device.pause",
			targetType: "energy_device",
			targetId: DEVICE_ID,
			orgId: "org-a",
			stepUpAt: STEP_UP_AT,
			before: { isPaused: false },
			after: { isPaused: true },
		});
	});

	it("resumes a paused schedule", async () => {
		allowDevice({ isPaused: true });

		const result = await remoteSetDevicePause({
			deviceId: DEVICE_ID,
			isPaused: false,
			reason: REASON,
		});

		expect(result).toEqual({ success: true, isPaused: false });
		expect(tx.energyDevice.update).toHaveBeenCalledWith({
			where: { id: DEVICE_ID },
			data: { isPaused: false },
		});
	});

	it("refuses to resume a fallow pond and records the refusal", async () => {
		allowDevice({ isPaused: true, isFallow: true });

		const result = await remoteSetDevicePause({
			deviceId: DEVICE_ID,
			isPaused: false,
			reason: REASON,
		});

		expect(result).toMatchObject({ success: false, code: "pause_refused" });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
		expect(auditRows()[0]).toMatchObject({
			action: "platform.device.pause_refused",
			orgId: "org-a",
			after: { isPaused: false, code: "pond_fallow" },
		});
	});
});
