import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	FARM_A,
	ORG_A_ID,
	POND_A_1,
	POND_A_1_NAME,
	POND_A_2,
	type TenancyUser,
	VIEWER_A_ID,
} from "./helpers/tenancy";

/**
 * Alert-email audience resolution.
 *
 * The org decides who is alertable (`alertRoles`); the account decides whether
 * it can receive mail at all (`contactEmail`). Both must agree, and a pond that
 * cannot be linked to an active organization still alerts its owner.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

import { resolvePondAlertAudiences } from "@/lib/notifications/alert-recipients";

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function setEmail(userId: string, value: string | null) {
	const user = tenancy().tables.users.find((row) => row.id === userId) as
		| (TenancyUser & { contactEmail?: string | null })
		| undefined;
	if (!user) throw new Error(`fixture user ${userId} not found`);
	user.contactEmail = value;
}

function setOrgStatus(status: string) {
	const org = tenancy().tables.organizations.find((row) => row.id === ORG_A_ID);
	if (!org) throw new Error("org A missing");
	(org as { status: string }).status = status;
}

beforeEach(() => {
	tenancy().reset();
	setEmail(ADMIN_A_ID, "admin.a@example.test");
	setEmail(FARMER_A_ID, "farmer.a@example.test");
	setEmail(VIEWER_A_ID, "viewer.a@example.test");
});

describe("resolvePondAlertAudiences", () => {
	it("keeps only roles the organization chose and accounts with an address", async () => {
		const audiences = await resolvePondAlertAudiences([POND_A_1]);
		const audience = audiences.get(POND_A_1);

		expect(audience).toMatchObject({
			pondId: POND_A_1,
			farmId: FARM_A,
			orgId: ORG_A_ID,
			roles: expect.arrayContaining(["OWNER", "ADMIN"]),
		});
		// ADMIN_A and PLATFORM_ADMIN_A are OWNER; FARMER_A is OPERATOR and
		// VIEWER_A is VIEWER, both outside the default alert roles.
		expect(audience?.emails.sort()).toEqual(["admin.a@example.test"]);
		expect(audience?.pondName).toBe(POND_A_1_NAME);
	});

	it("sends nothing when the only alertable accounts have no contact email", async () => {
		setEmail(ADMIN_A_ID, null);

		// PLATFORM_ADMIN_A has no fixture email either.
		const audiences = await resolvePondAlertAudiences([POND_A_1]);

		expect(audiences.get(POND_A_1)?.emails).toEqual([]);
	});

	it("falls back to the owner when the organization is not ACTIVE", async () => {
		setOrgStatus("SUSPENDED");

		const audiences = await resolvePondAlertAudiences([POND_A_1]);
		const audience = audiences.get(POND_A_1);

		expect(audience?.orgId).toBeNull();
		expect(audience?.emails).toEqual(["farmer.a@example.test"]);
	});

	it("resolves several ponds in one call and ignores unknown ids", async () => {
		const audiences = await resolvePondAlertAudiences([POND_A_1, POND_A_2, "missing-pond"]);

		expect([...audiences.keys()].sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(audiences.get(POND_A_2)?.emails).toEqual(["admin.a@example.test"]);
	});

	it("returns an empty map for an empty request", async () => {
		expect((await resolvePondAlertAudiences([])).size).toBe(0);
	});
});
