import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Behavioural tests for `updateOrgSettings` (issue #190).
 *
 * The real tenant-admin guard, permission resolver and org scope run against the
 * two-org fixture, so an operator, a denied permission and a foreign org are
 * refused by the same code paths production uses — not by a stubbed gate.
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

import { updateOrgSettings } from "@/lib/actions/org-settings";
import { getCurrentUser } from "@/lib/auth/session";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	MEMBERSHIP_ADMIN_A,
	ORG_A_ID,
	ORG_B_ID,
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

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	signInAs(ADMIN_A_ID);
});

describe("updateOrgSettings", () => {
	it("lets an org admin save a partial patch and writes one audit row", async () => {
		const result = await updateOrgSettings({
			orgId: ORG_A_ID,
			hopperLowPct: 35,
			alertRoles: ["OWNER", "OPERATOR"],
		});

		expect(result).toEqual({ success: true });
		const row = tenancy().tables.orgSettings.find((setting) => setting.orgId === ORG_A_ID);
		expect(row).toMatchObject({
			orgId: ORG_A_ID,
			hopperLowPct: 35,
			alertRoles: ["OWNER", "OPERATOR"],
			// Untouched fields keep the schema defaults.
			defaultFeedingRatePct: 3,
			offlineAfterMin: 30,
			missedFeedingAlerts: true,
			deviceRegistration: "ADMIN_APPROVAL",
			updatedById: ADMIN_A_ID,
		});

		expect(tenancy().tables.platformAuditLogs).toHaveLength(1);
		expect(tenancy().tables.platformAuditLogs[0]).toMatchObject({
			actorUserId: ADMIN_A_ID,
			action: "org.settings.update",
			targetType: "org_setting",
			targetId: ORG_A_ID,
			orgId: ORG_A_ID,
		});
	});

	it("updates an existing row without dropping fields the card did not send", async () => {
		tenancy().tables.orgSettings.push({
			orgId: ORG_A_ID,
			defaultFeedingRatePct: 5,
			hopperLowPct: 30,
			offlineAfterMin: 60,
			missedFeedingAlerts: false,
			alertRoles: ["OWNER"],
			deviceRegistration: "SELF_REGISTER",
			updatedById: null,
			updatedAt: new Date(),
		});

		await updateOrgSettings({ orgId: ORG_A_ID, missedFeedingAlerts: true });

		expect(tenancy().tables.orgSettings).toHaveLength(1);
		expect(tenancy().tables.orgSettings[0]).toMatchObject({
			defaultFeedingRatePct: 5,
			hopperLowPct: 30,
			offlineAfterMin: 60,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER"],
			deviceRegistration: "SELF_REGISTER",
		});
	});

	it("denies an operator (not a tenant admin) and writes nothing", async () => {
		signInAs(FARMER_A_ID);

		await expect(updateOrgSettings({ orgId: ORG_A_ID, hopperLowPct: 40 })).rejects.toThrow(
			"NEXT_REDIRECT",
		);

		expect(tenancy().tables.orgSettings).toHaveLength(0);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("denies an admin whose manage_farms_ponds permission is revoked", async () => {
		tenancy().tables.membershipPermissions.push({
			id: "perm-denied",
			membershipId: MEMBERSHIP_ADMIN_A,
			permission: "manage_farms_ponds",
			grantedAt: new Date(),
			revokedAt: new Date(),
		});

		await expect(updateOrgSettings({ orgId: ORG_A_ID, hopperLowPct: 40 })).rejects.toThrow(
			"Forbidden",
		);

		expect(tenancy().tables.orgSettings).toHaveLength(0);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("refuses another organization's settings without touching them", async () => {
		const result = await updateOrgSettings({ orgId: ORG_B_ID, hopperLowPct: 40 });

		expect(result).toEqual({ error: "That organization is outside your scope." });
		expect(tenancy().tables.orgSettings).toHaveLength(0);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("rejects out-of-range values before writing", async () => {
		const result = await updateOrgSettings({ orgId: ORG_A_ID, hopperLowPct: 70 });

		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("hopperLowPct");
		expect(tenancy().tables.orgSettings).toHaveLength(0);
		expect(tenancy().tables.platformAuditLogs).toHaveLength(0);
	});

	it("requires at least one alert role", async () => {
		const result = await updateOrgSettings({ orgId: ORG_A_ID, alertRoles: [] });

		expect(result).toHaveProperty("error");
		expect(tenancy().tables.orgSettings).toHaveLength(0);
	});
});
