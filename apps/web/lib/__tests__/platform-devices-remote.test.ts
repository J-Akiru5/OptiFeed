import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Remote feeder control is platform god mode (decision D1). It has no "force"
 * flag: the same §6 caps as the tenant dashboard decide, a refusal is audited,
 * and nothing is written without a fresh step-up. The pond-option read is the
 * other half of the page: an admin may only target ponds of an ACTIVE org's
 * active members.
 */

const { db, tx, createManualFeedRequest, setSchedulePause } = vi.hoisted(() => {
	const tx = { platformAuditLog: { create: vi.fn() } };
	const db = {
		energyDevice: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		membership: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		pond: { findMany: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
		$transaction: vi.fn(),
	};
	return {
		db,
		tx,
		createManualFeedRequest: vi.fn(),
		setSchedulePause: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/feed/commands", () => ({ createManualFeedRequest, setSchedulePause }));
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
	headers: vi.fn(async () => new Headers({ "x-real-ip": "198.51.100.4", "user-agent": "vitest" })),
}));

import {
	getOrgPondOptions,
	remoteFeedDevice,
	remoteSetDevicePause,
} from "@/lib/actions/platform/devices";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);
const REASON = "Coop reported an empty trough on pond A";

function allowDevice(overrides: Record<string, unknown> = {}) {
	db.energyDevice.findUnique.mockResolvedValue({
		id: "dev-1",
		isPaused: false,
		pond: { ownerId: "farm-a" },
		...overrides,
	});
	db.user.findMany.mockResolvedValue([{ id: "u-a", farmId: "farm-a" }]);
	db.membership.findMany.mockResolvedValue([{ userId: "u-a", orgId: "org-a" }]);
	db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("platform gate", () => {
	it("denies the pond-option read", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(getOrgPondOptions()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.findMany).not.toHaveBeenCalled();
	});

	it("denies remote feeding before reading a device", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(
			remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON }),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});

	it("denies a remote pause before reading a device", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(
			remoteSetDevicePause({ deviceId: "dev-1", isPaused: true, reason: REASON }),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});
});

describe("getOrgPondOptions", () => {
	it("returns nothing when there is no active organization", async () => {
		db.organization.findMany.mockResolvedValue([]);

		await expect(getOrgPondOptions()).resolves.toEqual([]);
		expect(db.membership.findMany).not.toHaveBeenCalled();
	});

	it("maps active members' ponds to their organization with the device count", async () => {
		db.organization.findMany.mockResolvedValue([
			{ id: "org-a", name: "Org A" },
			{ id: "org-b", name: "Org B" },
		]);
		db.membership.findMany.mockResolvedValue([
			{ orgId: "org-a", userId: "u-a" },
			{ orgId: "org-b", userId: "u-b" },
		]);
		db.user.findMany.mockResolvedValue([
			{ id: "u-a", farmId: "farm-a" },
			{ id: "u-b", farmId: "farm-b" },
		]);
		db.pond.findMany.mockResolvedValue([
			{ id: "pond-a", name: "Pond A", ownerId: "farm-a", _count: { energyDevices: 2 } },
			{ id: "pond-b", name: "Pond B", ownerId: "farm-b", _count: { energyDevices: 0 } },
		]);

		const options = await getOrgPondOptions();

		expect(db.organization.findMany).toHaveBeenCalledWith({
			where: { status: "ACTIVE" },
			orderBy: { name: "asc" },
			select: { id: true, name: true },
		});
		expect(options).toEqual([
			{
				orgId: "org-a",
				orgName: "Org A",
				ponds: [{ id: "pond-a", name: "Pond A", ownerFarmId: "farm-a", deviceCount: 2 }],
			},
			{
				orgId: "org-b",
				orgName: "Org B",
				ponds: [{ id: "pond-b", name: "Pond B", ownerFarmId: "farm-b", deviceCount: 0 }],
			},
		]);
	});

	it("drops a membership whose account has no farm", async () => {
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);
		db.membership.findMany.mockResolvedValue([
			{ orgId: "org-a", userId: "u-a" },
			{ orgId: "org-a", userId: "u-missing" },
		]);
		db.user.findMany.mockResolvedValue([{ id: "u-a", farmId: "farm-a" }]);
		db.pond.findMany.mockResolvedValue([
			{ id: "pond-a", name: "Pond A", ownerId: "farm-a", _count: { energyDevices: 1 } },
			{ id: "pond-x", name: "Pond X", ownerId: "farm-x", _count: { energyDevices: 0 } },
		]);

		const [option] = await getOrgPondOptions();

		expect(option.ponds.map((pond) => pond.id)).toEqual(["pond-a"]);
	});

	it("skips the pond query when no member has a farm", async () => {
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);
		db.membership.findMany.mockResolvedValue([]);

		const [option] = await getOrgPondOptions();

		expect(option.ponds).toEqual([]);
		expect(db.pond.findMany).not.toHaveBeenCalled();
	});
});

describe("remoteFeedDevice guards", () => {
	it("requires a reason", async () => {
		await expect(
			remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: "short" }),
		).resolves.toEqual({ error: expect.stringContaining("reason") });
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});

	it("requires a device", async () => {
		await expect(remoteFeedDevice({ deviceId: "", grams: 150, reason: REASON })).resolves.toEqual({
			error: "A device is required.",
		});
	});

	it("requires a finite feed amount", async () => {
		await expect(
			remoteFeedDevice({ deviceId: "dev-1", grams: Number.NaN, reason: REASON }),
		).resolves.toEqual({ error: "Enter the feed amount in grams." });
	});

	it("answers not found for an unknown device", async () => {
		db.energyDevice.findUnique.mockResolvedValue(null);

		await expect(
			remoteFeedDevice({ deviceId: "nope", grams: 150, reason: REASON }),
		).resolves.toEqual({ error: "Device not found." });
	});

	it("returns step_up_required and sends no command without a fresh check", async () => {
		allowDevice();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Re-enter your password."), { code: "step_up_required" }),
		);

		const result = await remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON });

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(createManualFeedRequest).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});
});

describe("remoteFeedDevice command outcomes", () => {
	it("returns the refusal and audits it with the command's code", async () => {
		allowDevice();
		createManualFeedRequest.mockResolvedValue({
			ok: false,
			code: "hopper_empty",
			error: "The hopper is empty.",
		});

		const result = await remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON });

		expect(result).toEqual({
			success: false,
			code: "feed_refused",
			error: "The hopper is empty.",
		});
		expect(createManualFeedRequest).toHaveBeenCalledWith(tx, {
			deviceId: "dev-1",
			grams: 150,
			actorId: "admin-1",
			triggerSource: "platform_remote",
		});
		const row = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.device.feed_refused",
			targetType: "energy_device",
			targetId: "dev-1",
			orgId: "org-a",
			reason: REASON,
			actorUserId: "admin-1",
			after: { grams: 150, code: "hopper_empty", error: "The hopper is empty." },
		});
	});

	it("issues the feed and audits the request id", async () => {
		allowDevice();
		createManualFeedRequest.mockResolvedValue({
			ok: true,
			requestId: "req-1",
			alreadyPending: false,
		});

		const result = await remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON });

		expect(result).toEqual({ success: true });
		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			action: "platform.device.feed",
			orgId: "org-a",
			after: { grams: 150, requestId: "req-1", alreadyPending: false },
		});
	});

	it("reports an already-pending command without sending a second one", async () => {
		allowDevice();
		createManualFeedRequest.mockResolvedValue({
			ok: true,
			requestId: "req-1",
			alreadyPending: true,
		});

		await expect(
			remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON }),
		).resolves.toEqual({ success: true, message: "Feed already pending" });
	});

	it("records a null org for a legacy device with no pond", async () => {
		allowDevice({ pond: null });
		createManualFeedRequest.mockResolvedValue({
			ok: true,
			requestId: "req-1",
			alreadyPending: false,
		});

		await remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON });

		expect(db.user.findMany).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create.mock.calls[0][0].data.orgId).toBeNull();
	});

	it("reports a generic failure when the command throws", async () => {
		allowDevice();
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(new Error("connection reset"));

		await expect(
			remoteFeedDevice({ deviceId: "dev-1", grams: 150, reason: REASON }),
		).resolves.toEqual({ error: "Failed to send the feed command." });
		spy.mockRestore();
	});
});

describe("remoteSetDevicePause", () => {
	it("requires pause or resume to be stated", async () => {
		await expect(
			remoteSetDevicePause({ deviceId: "dev-1", isPaused: "yes" as never, reason: REASON }),
		).resolves.toEqual({ error: "Choose pause or resume." });
	});

	it("returns the refusal when the schedule change is not allowed", async () => {
		allowDevice();
		setSchedulePause.mockResolvedValue({
			ok: false,
			code: "fallow_pond",
			error: "This pond is fallow.",
		});

		const result = await remoteSetDevicePause({
			deviceId: "dev-1",
			isPaused: true,
			reason: REASON,
		});

		expect(result).toEqual({
			success: false,
			code: "pause_refused",
			error: "This pond is fallow.",
		});
		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			action: "platform.device.pause_refused",
			after: { isPaused: true, code: "fallow_pond", error: "This pond is fallow." },
		});
	});

	it("pauses the feeder and audits the previous state", async () => {
		allowDevice({ isPaused: false });
		setSchedulePause.mockResolvedValue({ ok: true, wasPaused: false });

		const result = await remoteSetDevicePause({
			deviceId: "dev-1",
			isPaused: true,
			reason: REASON,
		});

		expect(result).toEqual({ success: true, isPaused: true });
		expect(setSchedulePause).toHaveBeenCalledWith(tx, {
			deviceId: "dev-1",
			isPaused: true,
			actorId: "admin-1",
		});
		expect(tx.platformAuditLog.create.mock.calls[0][0].data).toMatchObject({
			action: "platform.device.pause",
			before: { isPaused: false },
			after: { isPaused: true },
		});
	});

	it("answers not found for an unknown device", async () => {
		db.energyDevice.findUnique.mockResolvedValue(null);

		await expect(
			remoteSetDevicePause({ deviceId: "nope", isPaused: false, reason: REASON }),
		).resolves.toEqual({ error: "Device not found." });
	});

	it("returns step_up_required without changing the schedule", async () => {
		allowDevice();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Re-enter your password."), { code: "step_up_required" }),
		);

		const result = await remoteSetDevicePause({
			deviceId: "dev-1",
			isPaused: true,
			reason: REASON,
		});

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(setSchedulePause).not.toHaveBeenCalled();
	});
});
