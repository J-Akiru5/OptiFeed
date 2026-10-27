import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pond management actions (#202 / decision E22).
 *
 * The tenant guards and org scope are mocked at their module boundary so each
 * test can drive an allow or a deny without a database. Every mutation is
 * asserted through its audit row, and the cross-org cases pass a foreign id
 * that the real scope filters would exclude.
 */

const { db, tx } = vi.hoisted(() => {
	const tx = {
		farm: { upsert: vi.fn() },
		pond: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
		cropCycle: { create: vi.fn(), count: vi.fn() },
		pondEvent: { createMany: vi.fn(), count: vi.fn() },
		biomassLog: { count: vi.fn() },
		feedEvent: { count: vi.fn() },
		energyDevice: { count: vi.fn(), update: vi.fn() },
		device: { count: vi.fn() },
		fcrReport: { count: vi.fn() },
		scheduleCommand: { count: vi.fn(), create: vi.fn() },
		notification: { count: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		user: { findUnique: vi.fn(), findMany: vi.fn() },
		farm: { upsert: vi.fn() },
		pond: {
			create: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		cropCycle: { create: vi.fn(), count: vi.fn() },
		pondEvent: { createMany: vi.fn(), count: vi.fn() },
		biomassLog: { count: vi.fn() },
		feedEvent: { count: vi.fn() },
		energyDevice: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			count: vi.fn(),
			update: vi.fn(),
		},
		device: { count: vi.fn() },
		fcrReport: { count: vi.fn() },
		scheduleCommand: { count: vi.fn() },
		notification: { count: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		platformAuditLog: { create: vi.fn() },
		orgSetting: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/actions/platform/audit", () => ({ writePlatformAudit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "actor-a" })),
	assertPasswordChanged: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/tenant-admin", () => ({
	requireTenantAdmin: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (at: Date) => Promise<unknown>) =>
		action(new Date("2026-10-27T00:00:00.000Z")),
	),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" && error !== null && "code" in error === true
			? (error as { code?: unknown }).code === "step_up_required"
			: false,
}));
vi.mock("@/lib/settings/org", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/settings/org")>();
	return { ...actual, getOrgSettings: vi.fn(async () => actual.ORG_SETTINGS_DEFAULTS) };
});
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import {
	createTenantPond,
	deleteTenantPond,
	getPondDeletionCheck,
	getPondDetail,
	getPondOwnerOptions,
	moveDeviceToPond,
	unassignDevice,
	updateTenantPond,
} from "@/lib/actions/ponds";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requirePermission } from "@/lib/auth/permissions";
import { withStepUp } from "@/lib/auth/step-up";

const mockScope = vi.mocked(resolveOrgScope);
const mockPermission = vi.mocked(requirePermission);
const mockWithStepUp = vi.mocked(withStepUp);
const mockAudit = vi.mocked(writePlatformAudit);

const SCOPE_A = {
	orgIds: ["org-a"],
	memberUserIds: ["user-a"],
	farmIds: ["farm-a"],
	pondIds: ["pond-a-1", "pond-a-2"],
};
const SCOPE_B = {
	orgIds: ["org-b"],
	memberUserIds: ["user-b"],
	farmIds: ["farm-b"],
	pondIds: ["pond-b-1"],
};

const CREATED_POND = {
	id: "pond-new",
	name: "Pond New",
	ownerId: "farm-a",
	farmId: "farm-row-a",
	feedingRatePct: 3,
	feedsPerDay: 3,
	population: null as number | null,
	sampleIntervalDays: 14,
};

const POND_BEFORE = {
	id: "pond-a-1",
	name: "Pond A One",
	ownerId: "farm-a",
	farmId: "farm-row-a",
	feedingRatePct: 3,
	feedsPerDay: 3,
	population: 500,
	sampleIntervalDays: 14,
	scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
	scheduleEnd: new Date("1970-01-01T18:00:00.000Z"),
};

function zeroBlockerCounts(client: typeof db | typeof tx) {
	client.biomassLog.count.mockResolvedValue(0);
	client.feedEvent.count.mockResolvedValue(0);
	client.cropCycle.count.mockResolvedValue(0);
	client.energyDevice.count.mockResolvedValue(0);
	client.device.count.mockResolvedValue(0);
	client.fcrReport.count.mockResolvedValue(0);
	client.scheduleCommand.count.mockResolvedValue(0);
	client.notification.count.mockResolvedValue(0);
	client.pondEvent.count.mockResolvedValue(0);
}

const CREATE_INPUT = {
	name: "Pond New",
	ownerFarmId: "farm-a",
	feedingRatePct: 3,
	feedsPerDay: 3,
	scheduleStart: "06:00",
	scheduleEnd: "18:00",
	sampleIntervalDays: 14,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockScope.mockResolvedValue(SCOPE_A);
	db.user.findUnique.mockResolvedValue({ farmId: "farm-a", displayName: "Juan" });
	db.user.findMany.mockResolvedValue([
		{
			farmId: "farm-a",
			displayName: "Juan",
			email: "juan@example.com",
			farm: { name: "Juan Farm" },
		},
	]);
	db.energyDevice.findMany.mockResolvedValue([]);
	db.feedEvent.count.mockResolvedValue(0);
	db.pond.findFirst.mockResolvedValue(POND_BEFORE);
	tx.farm.upsert.mockResolvedValue({ id: "farm-row-a" });
	tx.pond.create.mockResolvedValue(CREATED_POND);
	tx.pond.update.mockResolvedValue({ ...POND_BEFORE, name: "Renamed" });
	tx.cropCycle.create.mockResolvedValue({ id: "cycle-1" });
	tx.energyDevice.update.mockResolvedValue({});
	tx.scheduleCommand.create.mockResolvedValue({ id: "command-1" });
	zeroBlockerCounts(db);
	zeroBlockerCounts(tx);
});

describe("createTenantPond", () => {
	it("creates a pond for an org farm and audits it", async () => {
		const result = await createTenantPond(CREATE_INPUT);

		expect(result).toEqual({ success: true, pondId: "pond-new" });
		expect(tx.pond.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					name: "Pond New",
					ownerId: "farm-a",
					farmId: "farm-row-a",
					feedingRatePct: 3,
				}),
			}),
		);
		expect(mockAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ action: "pond.create", targetType: "pond", orgId: "org-a" }),
		);
		expect(tx.cropCycle.create).not.toHaveBeenCalled();
	});

	it("starts a grow-out cycle when a stocking date is supplied", async () => {
		const result = await createTenantPond({
			...CREATE_INPUT,
			population: 800,
			stockingDate: "2026-10-01",
		});

		expect(result).toEqual({ success: true, pondId: "pond-new" });
		expect(tx.cropCycle.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ pondId: "pond-new", stockingCount: 800 }),
			}),
		);
		expect(tx.pondEvent.createMany).toHaveBeenCalledTimes(1);
	});

	it("refuses a stocking date without a population", async () => {
		const result = await createTenantPond({ ...CREATE_INPUT, stockingDate: "2026-10-01" });
		expect(result).toEqual({
			error: "Enter the population to start a cycle from the stocking date.",
		});
		expect(tx.pond.create).not.toHaveBeenCalled();
	});

	it("refuses a farm outside the caller's organization", async () => {
		const result = await createTenantPond({ ...CREATE_INPUT, ownerFarmId: "farm-b" });
		expect(result).toEqual({ error: "That farm is outside your organization." });
		expect(tx.pond.create).not.toHaveBeenCalled();
	});

	it("denies a caller without manage_farms_ponds", async () => {
		mockPermission.mockRejectedValueOnce(new Error("Forbidden"));
		await expect(createTenantPond(CREATE_INPUT)).rejects.toThrow("Forbidden");
		expect(tx.pond.create).not.toHaveBeenCalled();
	});
});

describe("updateTenantPond", () => {
	it("updates every editable field and records before/after", async () => {
		const result = await updateTenantPond({
			pondId: "pond-a-1",
			name: "Renamed",
			ownerFarmId: "farm-a",
			population: 500,
			feedingRatePct: 4,
			feedsPerDay: 2,
			scheduleStart: "05:00",
			scheduleEnd: "17:00",
			sampleIntervalDays: 10,
		});

		expect(result).toEqual({ success: true });
		expect(tx.pond.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "pond-a-1" },
				data: expect.objectContaining({ name: "Renamed", feedsPerDay: 2, sampleIntervalDays: 10 }),
			}),
		);
		expect(mockAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				action: "pond.update",
				before: expect.any(Object),
				after: expect.any(Object),
			}),
		);
	});

	it("queues the new schedule for feeders on the pond", async () => {
		db.energyDevice.findMany.mockResolvedValue([
			{
				id: "device-a-1",
				buttonFeedGrams: 80,
				gramsPerFeeding: 150,
				gramsPerSecond: 4,
				hopperCapacityG: 7000,
			},
		]);

		const result = await updateTenantPond({
			pondId: "pond-a-1",
			name: "Renamed",
			ownerFarmId: "farm-a",
			population: 500,
			feedingRatePct: 4,
			feedsPerDay: 2,
			scheduleStart: "05:00",
			scheduleEnd: "17:00",
			sampleIntervalDays: 10,
		});

		expect(result).toEqual({ success: true });
		expect(tx.scheduleCommand.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					deviceId: "device-a-1",
					feedsPerDay: 2,
					feedingRatePct: 4,
				}),
			}),
		);
		expect(tx.deviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ eventType: "schedule_changed" }),
			}),
		);
	});

	it("refuses a schedule that exceeds the device daily cap", async () => {
		db.energyDevice.findMany.mockResolvedValue([
			{
				id: "device-a-1",
				buttonFeedGrams: 80,
				gramsPerFeeding: 1000,
				gramsPerSecond: 4,
				hopperCapacityG: 100,
			},
		]);

		const result = await updateTenantPond({
			pondId: "pond-a-1",
			name: "Renamed",
			ownerFarmId: "farm-a",
			population: 500,
			feedingRatePct: 4,
			feedsPerDay: 2,
			scheduleStart: "05:00",
			scheduleEnd: "17:00",
			sampleIntervalDays: 10,
		});

		expect(result).toMatchObject({ error: expect.stringContaining("over the") });
		expect(tx.pond.update).not.toHaveBeenCalled();
	});

	it("refuses another organization's pond", async () => {
		const result = await updateTenantPond({
			pondId: "pond-b-1",
			name: "Hijack",
			ownerFarmId: "farm-a",
			population: null,
			feedingRatePct: 3,
			feedsPerDay: 3,
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			sampleIntervalDays: 14,
		});
		expect(result).toEqual({ error: "That pond is outside your organization." });
		expect(tx.pond.update).not.toHaveBeenCalled();
	});

	it("refuses an owner outside the caller's organization", async () => {
		const result = await updateTenantPond({
			pondId: "pond-a-1",
			name: "Pond",
			ownerFarmId: "farm-b",
			population: null,
			feedingRatePct: 3,
			feedsPerDay: 3,
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			sampleIntervalDays: 14,
		});
		expect(result).toEqual({ error: "That farm is outside your organization." });
		expect(tx.pond.update).not.toHaveBeenCalled();
	});

	it("denies a caller without manage_farms_ponds", async () => {
		mockPermission.mockRejectedValueOnce(new Error("Forbidden"));
		await expect(
			updateTenantPond({
				pondId: "pond-a-1",
				name: "Pond",
				ownerFarmId: "farm-a",
				population: null,
				feedingRatePct: 3,
				feedsPerDay: 3,
				scheduleStart: "06:00",
				scheduleEnd: "18:00",
				sampleIntervalDays: 14,
			}),
		).rejects.toThrow("Forbidden");
	});
});

describe("device moves and unassign", () => {
	const DEVICE = {
		id: "device-a-1",
		label: "Feeder A One",
		pondId: "pond-a-1",
		pond: { ownerId: "farm-a", name: "Pond A One" },
	};

	it("moves a feeder between two ponds of the same org", async () => {
		db.energyDevice.findFirst.mockResolvedValue(DEVICE);
		db.pond.findFirst.mockResolvedValue({ id: "pond-a-2", name: "Pond A Two", ownerId: "farm-a" });

		const result = await moveDeviceToPond({ deviceId: "device-a-1", targetPondId: "pond-a-2" });

		expect(result).toEqual({ success: true });
		expect(tx.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-a-1" },
			data: { pondId: "pond-a-2" },
		});
		expect(tx.deviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ eventType: "device_moved" }) }),
		);
		expect(mockAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ action: "pond.device.move", targetType: "energy_device" }),
		);
	});

	it("refuses a target pond in another organization", async () => {
		const result = await moveDeviceToPond({ deviceId: "device-a-1", targetPondId: "pond-b-1" });
		expect(result).toEqual({ error: "That pond is outside your organization." });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("refuses a device outside the caller's organization", async () => {
		db.energyDevice.findFirst.mockResolvedValue(null);
		const result = await moveDeviceToPond({ deviceId: "device-b-1", targetPondId: "pond-a-2" });
		expect(result).toEqual({ error: "Device not found in your organization." });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
	});

	it("re-attaches a feeder this organization unassigned", async () => {
		db.energyDevice.findFirst.mockResolvedValue({
			...DEVICE,
			pondId: null,
			pond: null,
		});
		db.pond.findFirst.mockResolvedValue({ id: "pond-a-2", name: "Pond A Two", ownerId: "farm-a" });

		const result = await moveDeviceToPond({ deviceId: "device-a-1", targetPondId: "pond-a-2" });

		expect(result).toEqual({ success: true });
		// The unassigned branch is scoped by the org marker on the detach event.
		const where = db.energyDevice.findFirst.mock.calls[0]?.[0]?.where;
		expect(where).toMatchObject({
			OR: expect.arrayContaining([expect.objectContaining({ pondId: null })]),
		});
	});

	it("unassigns a feeder and warns through the audit row", async () => {
		db.energyDevice.findFirst.mockResolvedValue(DEVICE);

		const result = await unassignDevice("device-a-1");

		expect(result).toEqual({ success: true });
		expect(tx.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-a-1" },
			data: { pondId: null },
		});
		expect(tx.deviceStateEvent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ eventType: "device_unassigned" }),
			}),
		);
		expect(mockAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({ action: "pond.device.unassign" }),
		);
	});

	it("refuses to unassign another organization's device", async () => {
		db.energyDevice.findFirst.mockResolvedValue(null);
		const result = await unassignDevice("device-b-1");
		expect(result).toEqual({ error: "Device not found in your organization." });
		expect(tx.energyDevice.update).not.toHaveBeenCalled();
	});
});

describe("pond deletion", () => {
	const POND = { id: "pond-a-1", name: "Pond A One" };

	it("allows deletion of an empty pond with the typed name and step-up", async () => {
		db.pond.findFirst.mockResolvedValue(POND);

		const result = await deleteTenantPond({ pondId: "pond-a-1", confirmName: "Pond A One" });

		expect(result).toEqual({ success: true });
		expect(mockWithStepUp).toHaveBeenCalled();
		expect(tx.pond.delete).toHaveBeenCalledWith({ where: { id: "pond-a-1" } });
		expect(mockAudit).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				action: "pond.delete",
				stepUpAt: new Date("2026-10-27T00:00:00.000Z"),
			}),
		);
	});

	it("refuses deletion when the pond has history", async () => {
		db.pond.findFirst.mockResolvedValue(POND);
		db.biomassLog.count.mockResolvedValue(2);

		const result = await deleteTenantPond({ pondId: "pond-a-1", confirmName: "Pond A One" });

		expect(result).toMatchObject({
			error: "This pond has data or devices. Archive it instead.",
			blockers: { biomassLogs: 2 },
		});
		expect(tx.pond.delete).not.toHaveBeenCalled();
	});

	it("refuses a mismatched typed name", async () => {
		db.pond.findFirst.mockResolvedValue(POND);
		const result = await deleteTenantPond({ pondId: "pond-a-1", confirmName: "Pond" });
		expect(result).toEqual({ error: "Type the pond name exactly to confirm deletion." });
		expect(tx.pond.delete).not.toHaveBeenCalled();
	});

	it("refuses another organization's pond", async () => {
		const result = await deleteTenantPond({ pondId: "pond-b-1", confirmName: "Pond B One" });
		expect(result).toEqual({ error: "That pond is outside your organization." });
		expect(tx.pond.delete).not.toHaveBeenCalled();
	});

	it("returns step_up_required when the fresh check is missing", async () => {
		db.pond.findFirst.mockResolvedValue(POND);
		mockWithStepUp.mockRejectedValueOnce({
			code: "step_up_required",
			message: "Re-enter your password to continue.",
		});

		const result = await deleteTenantPond({ pondId: "pond-a-1", confirmName: "Pond A One" });

		expect(result).toEqual({
			error: "Re-enter your password to continue.",
			code: "step_up_required",
		});
		expect(tx.pond.delete).not.toHaveBeenCalled();
	});

	it("reports blockers on the delete page", async () => {
		db.pond.findFirst.mockResolvedValue({ ...POND, status: "ACTIVE" });
		db.biomassLog.count.mockResolvedValue(3);
		db.energyDevice.count.mockResolvedValue(1);

		const check = await getPondDeletionCheck("pond-a-1");

		expect(check).toMatchObject({
			pondName: "Pond A One",
			canDelete: false,
			blockers: { biomassLogs: 3, devices: 1 },
		});
	});

	it("counts a legacy Device row as hardware on the delete page", async () => {
		db.pond.findFirst.mockResolvedValue({ ...POND, status: "ACTIVE" });
		db.device.count.mockResolvedValue(1);

		const check = await getPondDeletionCheck("pond-a-1");

		// The deprecated Device table has no cascade, so a pond that still has
		// one cannot be deleted even though every other blocker is zero.
		expect(check).toMatchObject({ canDelete: false, blockers: { devices: 1 } });
	});

	it("refuses deletion when only a legacy Device row remains", async () => {
		db.pond.findFirst.mockResolvedValue(POND);
		db.device.count.mockResolvedValue(1);

		const result = await deleteTenantPond({ pondId: "pond-a-1", confirmName: "Pond A One" });

		expect(result).toMatchObject({
			error: "This pond has data or devices. Archive it instead.",
			blockers: { devices: 1 },
		});
		expect(tx.pond.delete).not.toHaveBeenCalled();
	});

	it("returns null for another organization's pond", async () => {
		expect(await getPondDeletionCheck("pond-b-1")).toBeNull();
	});
});

describe("pond reads", () => {
	it("returns detail only for a pond in scope", async () => {
		db.pond.findFirst.mockResolvedValue({
			...POND_BEFORE,
			owner: { displayName: "Juan", farmId: "farm-a", email: "juan@example.com" },
			farm: { id: "farm-row-a", name: "Juan Farm", ownerId: "farm-a" },
			energyDevices: [],
			cropCycles: [],
			biomassLogs: [],
			fcrReports: [],
			ownershipHistory: [],
			_count: {
				biomassLogs: 0,
				fcrReports: 0,
				cropCycles: 0,
				pondEvents: 0,
				energyDevices: 0,
				scheduleCommands: 0,
			},
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			status: "ACTIVE",
			isFallow: false,
		});

		const detail = await getPondDetail("pond-a-1");
		expect(detail?.pond.name).toBe("Pond A One");
		expect(await getPondDetail("pond-b-1")).toBeNull();
	});

	it("lists only owners in the caller's organization", async () => {
		const options = await getPondOwnerOptions();
		expect(options).toEqual([{ farmId: "farm-a", ownerName: "Juan", farmName: "Juan Farm" }]);
		expect(db.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { farmId: { in: ["farm-a"] } } }),
		);
	});

	it("returns no owners when the scope is empty", async () => {
		mockScope.mockResolvedValueOnce({
			orgIds: [],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		});
		expect(await getPondOwnerOptions()).toEqual([]);
	});

	it("denies detail reads without a tenant admin", async () => {
		const tenantAdmin = await import("@/lib/auth/tenant-admin");
		vi.mocked(tenantAdmin.requireTenantAdmin).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
		await expect(getPondDetail("pond-a-1")).rejects.toThrow("NEXT_REDIRECT");
	});
});
