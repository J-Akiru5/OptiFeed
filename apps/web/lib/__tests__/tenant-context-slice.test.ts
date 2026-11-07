import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * First converted tenant-console slice (#711, option B).
 *
 * `getTenantRegistrationOptions` is the pond list a tenant admin picks a new
 * feeder from. The test runs it against the real two-org fixture and records
 * which reads went through the tenant transaction and which stayed on the
 * privileged bootstrap client.
 *
 * What this proves: the tenant reads run on the transaction that applied
 * `set_config` for the caller's farm, ponds, org and user, and the result is
 * scoped to org A. What it does not prove: that Postgres applied the setting
 * or that `optifeed_app` sees fewer rows. That needs the two-tenant proof
 * against a real database.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	events: [] as string[],
	settings: [] as { key: string; value: string }[],
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	const db = createTenancyDb();
	holder.db = db;

	let inTransaction = false;

	/** Record which client a delegate call used, then run the real double. */
	function watch<T extends (...args: never[]) => Promise<unknown>>(label: string, fn: T): T {
		return ((...args: never[]) => {
			holder.events.push(`${inTransaction ? "tx" : "privileged"}:${label}`);
			return fn(...args);
		}) as T;
	}

	const wrapped = {
		...db.client,
		organization: {
			...db.client.organization,
			findUnique: watch("organization.findUnique", db.client.organization.findUnique),
		},
		pond: {
			...db.client.pond,
			findMany: watch("pond.findMany", db.client.pond.findMany),
		},
		orgSetting: {
			...db.client.orgSetting,
			findUnique: watch("orgSetting.findUnique", db.client.orgSetting.findUnique),
		},
		$executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
			const key = String(values[0]);
			holder.settings.push({ key, value: String(values[1]) });
			holder.events.push(`set_config:${key}`);
			return 1;
		},
		$transaction: async (
			work: (tx: unknown) => Promise<unknown>,
			_options?: { timeout?: number },
		) => {
			inTransaction = true;
			try {
				return await db.client.$transaction(() => work(wrapped));
			} finally {
				inTransaction = false;
			}
		},
	} as unknown as typeof db.client;

	return { default: wrapped };
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

import { getTenantRegistrationOptions } from "@/lib/actions/device-registration";
import { getCurrentUser } from "@/lib/auth/session";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	FARM_A,
	FARM_A_ADMIN,
	FARM_A_PLATFORM_ADMIN,
	FARM_A_VIEWER,
	ORG_A_ID,
	ORG_A_NAME,
	POND_A_1,
	POND_A_1_NAME,
	POND_A_2,
	POND_A_2_NAME,
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

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	holder.events = [];
	holder.settings = [];
	signInAs(ADMIN_A_ID);
});

describe("getTenantRegistrationOptions", () => {
	it("applies the caller's context before reading the org, the ponds and the settings", async () => {
		const result = await getTenantRegistrationOptions();

		expect(result).toMatchObject({
			orgId: ORG_A_ID,
			orgName: ORG_A_NAME,
			mode: "ADMIN_APPROVAL",
		});
		expect(result?.ponds).toEqual([
			{ id: POND_A_1, name: POND_A_1_NAME },
			{ id: POND_A_2, name: POND_A_2_NAME },
		]);
		expect(result?.ponds.map((pond) => pond.id)).not.toContain(POND_B_1);

		// Every setting carries this tenant, not an empty or global value.
		const settings = Object.fromEntries(holder.settings.map((row) => [row.key, row.value]));
		expect(settings["app.org_ids"]).toBe(ORG_A_ID);
		expect(settings["app.user_id"]).toBe(ADMIN_A_ID);
		expect(settings["app.supabase_id"]).toBe("sb-admin-a");
		expect(settings["app.farm_ids"]?.split(",").sort()).toEqual(
			[FARM_A, FARM_A_ADMIN, FARM_A_PLATFORM_ADMIN, FARM_A_VIEWER].sort(),
		);
		expect(settings["app.pond_ids"]?.split(",").sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(settings["app.farm_ids"]).not.toContain("farm-b");

		// The five settings land on the transaction connection before any tenant
		// read, and the slice's reads all use that same client.
		const firstTenantRead = holder.events.findIndex((event) => event.startsWith("tx:"));
		expect(firstTenantRead).toBeGreaterThanOrEqual(5);
		expect(holder.events.slice(firstTenantRead - 5, firstTenantRead)).toEqual([
			"set_config:app.farm_ids",
			"set_config:app.pond_ids",
			"set_config:app.user_id",
			"set_config:app.supabase_id",
			"set_config:app.org_ids",
		]);
		expect(holder.events.slice(firstTenantRead).sort()).toEqual(
			["tx:organization.findUnique", "tx:orgSetting.findUnique", "tx:pond.findMany"].sort(),
		);
	});

	it("keeps the context bootstrap on the privileged client", async () => {
		await getTenantRegistrationOptions();

		const bootstrapPondRead = holder.events.indexOf("privileged:pond.findMany");
		const firstTenantRead = holder.events.findIndex((event) => event.startsWith("tx:"));

		// `resolveOrgScope()` reads the caller's ponds to build the scope; that
		// read produces the context, so it cannot depend on it.
		expect(bootstrapPondRead).toBeGreaterThan(-1);
		expect(bootstrapPondRead).toBeLessThan(firstTenantRead);
	});

	it("reads the org's own registration policy through the tenant client", async () => {
		tenancy().tables.orgSettings.push({
			orgId: ORG_A_ID,
			defaultFeedingRatePct: 3,
			hopperLowPct: 20,
			offlineAfterMin: 30,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER", "ADMIN"],
			deviceRegistration: "SELF_REGISTER",
			updatedById: null,
			updatedAt: new Date(),
		});

		const result = await getTenantRegistrationOptions();

		expect(result?.mode).toBe("SELF_REGISTER");
		expect(holder.events).toContain("tx:orgSetting.findUnique");
	});

	it("never opens the tenant transaction for a caller who is not a tenant admin", async () => {
		signInAs(FARMER_A_ID);

		await expect(getTenantRegistrationOptions()).rejects.toThrow("NEXT_REDIRECT");

		expect(holder.settings).toEqual([]);
		expect(holder.events.some((event) => event.startsWith("tx:"))).toBe(false);
	});
});
