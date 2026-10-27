import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		energyDevice: { create: vi.fn(), update: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		energyDevice: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			findUnique: vi.fn(),
			count: vi.fn(),
		},
		organization: { findFirst: vi.fn(), findMany: vi.fn() },
		membership: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		pond: { findFirst: vi.fn(), findMany: vi.fn() },
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
		async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest" }),
	),
}));

const STEP_UP_AT = new Date("2026-10-26T00:00:00.000Z");

import {
	getPlatformDevicesForLabels,
	listPlatformDevices,
	registerDevice,
	rotateDeviceToken,
} from "@/lib/actions/platform/devices";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";
import { hashToken } from "@/lib/device-auth";
import { Prisma } from "@prisma/client";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);

const validInput = {
	mac: "a4-cf-12-7e-3b-09",
	label: "Pond 2 feeder",
	orgId: "org-a",
	pondId: "pond-a",
	reason: "New unit for the San Pablo coop",
};

function allowOrgAWithPondA() {
	db.organization.findFirst.mockResolvedValue({ id: "org-a" });
	db.membership.findMany.mockResolvedValue([{ userId: "u-a" }]);
	db.user.findMany.mockResolvedValue([{ farmId: "farm-a" }]);
	db.pond.findFirst.mockImplementation(
		async (args: { where: { id: string; ownerId: { in: string[] } } }) =>
			args.where.id === "pond-a" && args.where.ownerId.in.includes("farm-a")
				? { id: "pond-a" }
				: null,
	);
	db.energyDevice.findFirst.mockResolvedValue(null);
	tx.energyDevice.create.mockResolvedValue({ id: "dev-new" });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "admin-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
	// clearAllMocks keeps implementations; a failing write set by one test
	// must not leak into the next.
	tx.platformAuditLog.create.mockReset().mockResolvedValue({});
	tx.energyDevice.create.mockReset();
	tx.energyDevice.update.mockReset().mockResolvedValue({});
});

describe("registerDevice", () => {
	it("requires a platform admin before touching the database", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(registerDevice(validInput)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.findFirst).not.toHaveBeenCalled();
		expect(tx.energyDevice.create).not.toHaveBeenCalled();
	});

	it("requires a reason of at least 10 characters", async () => {
		const result = await registerDevice({ ...validInput, reason: "short" });
		expect(result).toEqual({ error: expect.stringContaining("reason") });
		expect(tx.energyDevice.create).not.toHaveBeenCalled();
	});

	it("rejects without a fresh step-up and writes nothing", async () => {
		allowOrgAWithPondA();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Re-enter your password to continue."), {
				code: "step_up_required",
			}),
		);

		const result = await registerDevice(validInput);

		expect(result).toMatchObject({
			error: expect.stringContaining("password"),
			code: "step_up_required",
		});
		expect(tx.energyDevice.create).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("rejects a MAC that is not 12 hex digits", async () => {
		const result = await registerDevice({ ...validInput, mac: "A4:CF:12" });
		expect(result).toEqual({ error: expect.stringContaining("12-digit MAC") });
		expect(db.organization.findFirst).not.toHaveBeenCalled();
	});

	it("requires a label", async () => {
		expect(await registerDevice({ ...validInput, label: "  " })).toEqual({
			error: "A device label is required.",
		});
	});

	it("rejects an org that is not active", async () => {
		allowOrgAWithPondA();
		db.organization.findFirst.mockResolvedValue(null);
		expect(await registerDevice(validInput)).toEqual({ error: "Choose an active organization." });
		expect(db.organization.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "org-a", status: "ACTIVE" } }),
		);
	});

	it("rejects a pond that belongs to another org", async () => {
		allowOrgAWithPondA();
		const result = await registerDevice({ ...validInput, pondId: "pond-of-org-b" });
		expect(result).toEqual({ error: "That pond does not belong to the chosen organization." });
		expect(tx.energyDevice.create).not.toHaveBeenCalled();
	});

	it("rejects a MAC that is already registered, case-insensitively", async () => {
		allowOrgAWithPondA();
		db.energyDevice.findFirst.mockResolvedValue({ id: "dev-old" });
		expect(await registerDevice(validInput)).toEqual({
			error: "A device with this MAC is already registered.",
		});
		expect(db.energyDevice.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { mac: { equals: "A4:CF:12:7E:3B:09", mode: "insensitive" } },
			}),
		);
		expect(tx.energyDevice.create).not.toHaveBeenCalled();
	});

	it("maps a unique-constraint race to the duplicate message", async () => {
		allowOrgAWithPondA();
		tx.energyDevice.create.mockRejectedValue(
			new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
				code: "P2002",
				clientVersion: "test",
			}),
		);
		expect(await registerDevice(validInput)).toEqual({
			error: "A device with this MAC is already registered.",
		});
	});

	it("creates the device with the canonical MAC and a hashed token, and returns the token once", async () => {
		allowOrgAWithPondA();
		const result = await registerDevice(validInput);

		expect(result).toMatchObject({ success: true, deviceId: "dev-new", mac: "A4:CF:12:7E:3B:09" });
		if (!("success" in result)) throw new Error("expected success");
		expect(result.token).toMatch(/^esp32-tok-[0-9a-f]{32}$/);

		const data = tx.energyDevice.create.mock.calls[0][0].data;
		expect(data).toMatchObject({
			mac: "A4:CF:12:7E:3B:09",
			label: "Pond 2 feeder",
			pondId: "pond-a",
		});
		expect(data.tokenHash).toBe(hashToken(result.token));
	});

	it("writes one audit row with target, org and origin, and never the token", async () => {
		allowOrgAWithPondA();
		const result = await registerDevice(validInput);
		if (!("success" in result)) throw new Error("expected success");

		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		const row = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(row).toMatchObject({
			actorUserId: "admin-1",
			action: "platform.device.create",
			targetType: "energy_device",
			targetId: "dev-new",
			orgId: "org-a",
			reason: "New unit for the San Pablo coop",
			stepUpAt: STEP_UP_AT,
			temporaryGrant: false,
			ip: "203.0.113.7",
			userAgent: "vitest",
			after: { mac: "A4:CF:12:7E:3B:09", label: "Pond 2 feeder", pondId: "pond-a" },
		});
		const serialized = JSON.stringify(row);
		expect(serialized).not.toContain(result.token);
		expect(serialized).not.toContain(hashToken(result.token));
	});

	it("flags the audit row when the admin acts on a time-boxed grant", async () => {
		allowOrgAWithPondA();
		db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) });
		await registerDevice(validInput);
		expect(tx.platformAuditLog.create.mock.calls[0][0].data.temporaryGrant).toBe(true);
	});

	it("never logs the token when the write fails", async () => {
		allowOrgAWithPondA();
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		tx.platformAuditLog.create.mockRejectedValue(new Error("audit insert failed"));
		const result = await registerDevice(validInput);
		expect(result).toEqual({ error: "Failed to register the device." });
		const logged = JSON.stringify(spy.mock.calls);
		expect(logged).not.toMatch(/esp32-tok-[0-9a-f]{32}/);
		spy.mockRestore();
	});
});

describe("rotateDeviceToken", () => {
	it("requires a platform admin", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(
			rotateDeviceToken({ deviceId: "dev-1", reason: "Token lost on site" }),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findUnique).not.toHaveBeenCalled();
	});

	it("requires a reason", async () => {
		const result = await rotateDeviceToken({ deviceId: "dev-1", reason: "x" });
		expect(result).toEqual({ error: expect.stringContaining("reason") });
	});

	it("answers not found for an unknown device", async () => {
		db.energyDevice.findUnique.mockResolvedValue(null);
		expect(await rotateDeviceToken({ deviceId: "nope", reason: "Token lost on site" })).toEqual({
			error: "Device not found.",
		});
	});

	it("rejects without a fresh step-up and leaves the token alone", async () => {
		db.energyDevice.findUnique.mockResolvedValue({
			id: "dev-1",
			mac: "A4:CF:12:7E:3B:09",
			pond: { ownerId: "farm-a" },
		});
		db.user.findMany.mockResolvedValue([{ id: "u-a", farmId: "farm-a" }]);
		db.membership.findMany.mockResolvedValue([{ userId: "u-a", orgId: "org-a" }]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Your step-up check expired."), {
				code: "step_up_required",
			}),
		);

		const result = await rotateDeviceToken({ deviceId: "dev-1", reason: "Token lost on site" });

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("replaces the token hash, so the old token no longer matches, and audits without the token", async () => {
		db.energyDevice.findUnique.mockResolvedValue({
			id: "dev-1",
			mac: "A4:CF:12:7E:3B:09",
			pond: { ownerId: "farm-a" },
		});
		db.user.findMany.mockResolvedValue([{ id: "u-a", farmId: "farm-a" }]);
		db.membership.findMany.mockResolvedValue([{ userId: "u-a", orgId: "org-a" }]);
		db.organization.findMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const result = await rotateDeviceToken({ deviceId: "dev-1", reason: "Token lost on site" });
		if (!("success" in result)) throw new Error("expected success");

		const update = tx.energyDevice.update.mock.calls[0][0];
		expect(update.where).toEqual({ id: "dev-1" });
		expect(update.data.tokenHash).toBe(hashToken(result.token));
		expect(update.data.tokenHash).not.toBe(hashToken("esp32-tok-cict-001"));

		const row = tx.platformAuditLog.create.mock.calls[0][0].data;
		expect(row).toMatchObject({
			action: "platform.device.rotate_token",
			targetType: "energy_device",
			targetId: "dev-1",
			orgId: "org-a",
			stepUpAt: STEP_UP_AT,
		});
		expect(JSON.stringify(row)).not.toContain(result.token);
	});
});

describe("read paths never select a credential", () => {
	it("listPlatformDevices selects display fields only and paginates", async () => {
		db.energyDevice.count.mockResolvedValue(120);
		db.energyDevice.findMany.mockResolvedValue([]);
		const page = await listPlatformDevices({ query: "3b09", page: 3 });

		const args = db.energyDevice.findMany.mock.calls[0][0];
		expect(Object.keys(args.select).sort()).toEqual([
			"createdAt",
			"id",
			"isPaused",
			"label",
			"lastSeenAt",
			"mac",
			"pond",
		]);
		expect(args.select).not.toHaveProperty("token");
		expect(args.select).not.toHaveProperty("tokenHash");
		expect(args.skip).toBe(100);
		expect(args.take).toBe(50);
		expect(page).toMatchObject({ total: 120, page: 3, pageSize: 50 });
	});

	it("listPlatformDevices requires a platform admin", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(listPlatformDevices()).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findMany).not.toHaveBeenCalled();
	});

	it("getPlatformDevicesForLabels selects id, label and mac only, in the requested order", async () => {
		db.energyDevice.findMany.mockResolvedValue([
			{ id: "b", label: "B", mac: "11:22:33:44:55:66" },
			{ id: "a", label: "A", mac: "A4:CF:12:7E:3B:09" },
		]);
		const rows = await getPlatformDevicesForLabels(["a", "b", "a", " "]);

		const args = db.energyDevice.findMany.mock.calls[0][0];
		expect(Object.keys(args.select).sort()).toEqual(["id", "label", "mac"]);
		expect(args.where).toEqual({ id: { in: ["a", "b"] } });
		expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
	});

	it("getPlatformDevicesForLabels requires a platform admin", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(getPlatformDevicesForLabels(["a"])).rejects.toThrow("NEXT_REDIRECT");
		expect(db.energyDevice.findMany).not.toHaveBeenCalled();
	});
});
