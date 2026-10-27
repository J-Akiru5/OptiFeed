import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Tenant device registration and approval (issue #190).
 *
 * Covers the org policy (ADMIN_APPROVAL vs SELF_REGISTER), the cross-org and
 * permission denials, the pending token rule and the approve/reject audit
 * events. The real tenant-admin guard, permission resolver and org scope run
 * against the two-org fixture.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn(async () => undefined),
	buildPondEmail: (farmId: string) => `${farmId.toLowerCase().trim()}@pond.optifeed.local`,
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceTokenRevealRateLimit: vi.fn(async () => ({ success: true, remaining: 9 })),
}));

import { revealDeviceToken } from "@/lib/actions/admin";
import {
	addTenantDevice,
	approveTenantDevice,
	rejectTenantDevice,
} from "@/lib/actions/device-registration";
import { getCurrentUser } from "@/lib/auth/session";
import {
	ADMIN_A_ID,
	ADMIN_B_ID,
	FARMER_A_ID,
	MEMBERSHIP_ADMIN_A,
	ORG_A_ID,
	POND_A_1,
	POND_B_1,
	userById,
} from "./helpers/tenancy";

const mockUser = vi.mocked(getCurrentUser);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

function setDeviceMode(orgId: string, mode: "ADMIN_APPROVAL" | "SELF_REGISTER") {
	const existing = tenancy().tables.orgSettings.find((row) => row.orgId === orgId);
	if (existing) {
		existing.deviceRegistration = mode;
		return;
	}
	tenancy().tables.orgSettings.push({
		orgId,
		defaultFeedingRatePct: 3,
		hopperLowPct: 20,
		offlineAfterMin: 30,
		missedFeedingAlerts: true,
		alertRoles: ["OWNER", "ADMIN"],
		deviceRegistration: mode,
		updatedById: null,
		updatedAt: new Date(),
	});
}

const INPUT = {
	mac: "A4:CF:12:AA:BB:01",
	label: "Pond A feeder",
	pondId: POND_A_1,
};

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	signInAs(ADMIN_A_ID);
});

describe("addTenantDevice", () => {
	it("creates a PENDING device without revealing its token under admin approval", async () => {
		const result = await addTenantDevice(INPUT);

		expect(result).toMatchObject({
			success: true,
			mac: "A4:CF:12:AA:BB:01",
			approvalStatus: "PENDING",
		});
		expect(result).not.toHaveProperty("token");

		const device = tenancy().tables.energyDevices.find(
			(row) => row.id === (result as { deviceId: string }).deviceId,
		);
		expect(device).toMatchObject({
			pondId: POND_A_1,
			approvalStatus: "PENDING",
		});
		expect(device?.token).toMatch(/^esp32-tok-/);
		expect(device?.tokenHash).toHaveLength(64);

		const event = tenancy().tables.deviceStateEvents.find(
			(row) => row.eventType === "device_registered",
		);
		expect(event).toMatchObject({ actorId: ADMIN_A_ID, source: "user" });
		// The credential never reaches the audit trail.
		expect(JSON.stringify(event?.metadata)).not.toContain("esp32-tok-");
	});

	it("creates an APPROVED device and reveals the token once under self-register", async () => {
		setDeviceMode(ORG_A_ID, "SELF_REGISTER");

		const result = await addTenantDevice(INPUT);

		expect(result).toMatchObject({ success: true, approvalStatus: "APPROVED" });
		const token = (result as { token?: string }).token;
		expect(token).toMatch(/^esp32-tok-/);

		const device = tenancy().tables.energyDevices.find(
			(row) => row.id === (result as { deviceId: string }).deviceId,
		);
		expect(device?.approvalStatus).toBe("APPROVED");
		expect(device?.token).toBe(token);
		expect(JSON.stringify(tenancy().tables.deviceStateEvents)).not.toContain(token as string);
	});

	it("denies an operator (not a tenant admin)", async () => {
		signInAs(FARMER_A_ID);

		await expect(addTenantDevice(INPUT)).rejects.toThrow("NEXT_REDIRECT");
		expect(tenancy().tables.energyDevices).toHaveLength(3);
	});

	it("denies an admin whose claim_feeder permission is revoked", async () => {
		tenancy().tables.membershipPermissions.push({
			id: "perm-claim-denied",
			membershipId: MEMBERSHIP_ADMIN_A,
			permission: "claim_feeder",
			grantedAt: new Date(),
			revokedAt: new Date(),
		});

		await expect(addTenantDevice(INPUT)).rejects.toThrow("Forbidden");
		expect(tenancy().tables.energyDevices).toHaveLength(3);
	});

	it("refuses a pond in another organization", async () => {
		const result = await addTenantDevice({ ...INPUT, pondId: POND_B_1 });

		expect(result).toEqual({ error: "That pond is outside your organization." });
		expect(tenancy().tables.energyDevices).toHaveLength(3);
	});

	it("refuses a duplicate MAC case-insensitively", async () => {
		const result = await addTenantDevice({ ...INPUT, mac: "a4-cf-12-7e-3b-09" });

		expect(result).toEqual({ error: "A device with this MAC is already registered." });
		expect(tenancy().tables.energyDevices).toHaveLength(3);
	});
});

describe("approveTenantDevice / rejectTenantDevice", () => {
	async function addPending(): Promise<string> {
		const result = await addTenantDevice({ ...INPUT, mac: "A4:CF:12:00:00:01" });
		if (!("success" in result)) throw new Error("expected a pending device");
		return result.deviceId;
	}

	it("approves a pending device and audits it", async () => {
		const deviceId = await addPending();

		expect(await approveTenantDevice(deviceId)).toEqual({ success: true });

		const device = tenancy().tables.energyDevices.find((row) => row.id === deviceId);
		expect(device?.approvalStatus).toBe("APPROVED");
		expect(
			tenancy().tables.deviceStateEvents.some(
				(row) => row.deviceId === deviceId && row.eventType === "device_approved",
			),
		).toBe(true);
	});

	it("rejects a pending device and audits it", async () => {
		const deviceId = await addPending();

		expect(await rejectTenantDevice(deviceId)).toEqual({ success: true });

		const device = tenancy().tables.energyDevices.find((row) => row.id === deviceId);
		expect(device?.approvalStatus).toBe("REJECTED");
		expect(
			tenancy().tables.deviceStateEvents.some(
				(row) => row.deviceId === deviceId && row.eventType === "device_rejected",
			),
		).toBe(true);
	});

	it("denies approving a device that belongs to another organization", async () => {
		signInAs(ADMIN_B_ID);
		const foreign = await addTenantDevice({
			mac: "A4:CF:12:00:00:02",
			label: "Org B feeder",
			pondId: POND_B_1,
		});
		if (!("success" in foreign)) throw new Error("expected a pending device");

		signInAs(ADMIN_A_ID);
		expect(await approveTenantDevice(foreign.deviceId)).toEqual({
			error: "Device not found in your organization.",
		});
		expect(
			tenancy().tables.energyDevices.find((row) => row.id === foreign.deviceId)?.approvalStatus,
		).toBe("PENDING");
	});

	it("denies an admin without claim_feeder", async () => {
		const deviceId = await addPending();
		tenancy().tables.membershipPermissions.push({
			id: "perm-claim-denied-2",
			membershipId: MEMBERSHIP_ADMIN_A,
			permission: "claim_feeder",
			grantedAt: new Date(),
			revokedAt: new Date(),
		});

		await expect(approveTenantDevice(deviceId)).rejects.toThrow("Forbidden");
		expect(tenancy().tables.energyDevices.find((row) => row.id === deviceId)?.approvalStatus).toBe(
			"PENDING",
		);
	});
});

describe("pending device token", () => {
	it("cannot be revealed until an admin approves it", async () => {
		const result = await addTenantDevice({ ...INPUT, mac: "A4:CF:12:00:00:03" });
		if (!("success" in result)) throw new Error("expected a pending device");

		const before = await revealDeviceToken(result.deviceId);
		expect(before).toMatchObject({ success: false });
		expect(JSON.stringify(before)).not.toContain("esp32-tok-");

		await approveTenantDevice(result.deviceId);

		const after = await revealDeviceToken(result.deviceId);
		expect(after).toMatchObject({ success: true, mac: "A4:CF:12:00:00:03" });
	});
});
