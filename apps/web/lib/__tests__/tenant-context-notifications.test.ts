import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Second converted slice of #711 (option B): the dashboard notification list.
 *
 * The test runs the real loader against the two-tenant fixture and records
 * which reads went through the tenant transaction and which stayed on the
 * privileged bootstrap client. It proves the application boundary: the
 * notification reads run after the five `set_config` calls, on the transaction
 * client, scoped to the caller's org. It does not prove that Postgres applied
 * the settings or that `optifeed_app` sees fewer rows — that is the two-tenant
 * proof against a real database (`docs/security/tenant-isolation-proof.md`).
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
		notification: {
			...db.client.notification,
			count: watch("notification.count", db.client.notification.count),
			findMany: watch("notification.findMany", db.client.notification.findMany),
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

import { getCurrentUser } from "@/lib/auth/session";
import { MissingTenantContextError, tenantPrisma } from "@/lib/db/tenant-context";
import { loadDashboardNotifications } from "@/lib/notifications/dashboard";
import {
	FARMER_A_ID,
	FARM_A,
	FARM_A_ADMIN,
	FARM_A_PLATFORM_ADMIN,
	FARM_A_VIEWER,
	ORG_A_ID,
	POND_A_1,
	POND_A_2,
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
	signInAs(FARMER_A_ID);
});

describe("loadDashboardNotifications", () => {
	it("reads the page inside runWithTenant with the member org context", async () => {
		await tenancy().client.notification.create({
			data: {
				pondId: POND_A_1,
				tier: "WARNING",
				category: "feeding",
				message: "Pond A one alert",
				createdAt: new Date("2026-10-20T09:00:00.000Z"),
			},
		});
		await tenancy().client.notification.create({
			data: {
				pondId: POND_A_2,
				tier: "INFO",
				category: "feeding",
				message: "Pond A two alert",
				createdAt: new Date("2026-10-20T09:01:00.000Z"),
			},
		});
		await tenancy().client.notification.create({
			data: {
				pondId: POND_B_1,
				tier: "WARNING",
				category: "feeding",
				message: "Pond B alert",
				createdAt: new Date("2026-10-20T09:02:00.000Z"),
			},
		});

		const result = await loadDashboardNotifications({
			pondId: POND_A_1,
			tier: "WARNING",
			category: "feeding",
			page: 1,
			pageSize: 20,
		});

		expect(result.total).toBe(1);
		expect(result.notifications.map((row) => row.message)).toEqual(["Pond A one alert"]);
		expect(result.notifications.map((row) => row.pondId)).not.toContain(POND_B_1);

		// Every setting carries the caller's org, not an empty or global value.
		const settings = Object.fromEntries(holder.settings.map((row) => [row.key, row.value]));
		expect(settings["app.org_ids"]).toBe(ORG_A_ID);
		expect(settings["app.user_id"]).toBe(FARMER_A_ID);
		expect(settings["app.supabase_id"]).toBe("sb-farmer-a");
		expect(settings["app.farm_ids"]?.split(",").sort()).toEqual(
			[FARM_A, FARM_A_ADMIN, FARM_A_PLATFORM_ADMIN, FARM_A_VIEWER].sort(),
		);
		expect(settings["app.pond_ids"]?.split(",").sort()).toEqual([POND_A_1, POND_A_2].sort());
		expect(settings["app.farm_ids"]).not.toContain("farm-b");

		// The five settings land on the transaction connection before any tenant
		// read, and both notification queries use that same client.
		const firstTenantRead = holder.events.findIndex((event) => event.startsWith("tx:"));
		expect(firstTenantRead).toBeGreaterThanOrEqual(5);
		expect(holder.events.slice(firstTenantRead - 5, firstTenantRead)).toEqual([
			"set_config:app.farm_ids",
			"set_config:app.pond_ids",
			"set_config:app.user_id",
			"set_config:app.supabase_id",
			"set_config:app.org_ids",
		]);
		expect(holder.events.slice(firstTenantRead)).toEqual([
			"tx:notification.count",
			"tx:notification.findMany",
		]);

		// The context does not outlive the request that created it.
		expect(() => tenantPrisma()).toThrow(MissingTenantContextError);
	});

	it("re-reads a clamped page through the same tenant client", async () => {
		const base = new Date("2026-10-20T09:00:00.000Z").getTime();
		await tenancy().client.notification.createMany({
			data: Array.from({ length: 21 }, (_, index) => ({
				pondId: POND_A_1,
				tier: "INFO",
				message: `Pond A alert ${index}`,
				createdAt: new Date(base + index * 60_000),
			})),
		});

		const result = await loadDashboardNotifications({
			pondId: POND_A_1,
			page: 99,
			pageSize: 20,
		});

		expect(result.paging.page).toBe(2);
		expect(result.total).toBe(21);
		expect(result.notifications).toHaveLength(1);
		// The first fetch used the requested page, then the clamped page was read
		// again; both findMany calls must be on the tenant transaction.
		expect(holder.events.filter((event) => event === "tx:notification.findMany")).toHaveLength(2);
	});

	it("refuses to read without an authenticated user", async () => {
		mockUser.mockResolvedValue(null);

		await expect(
			loadDashboardNotifications({ pondId: POND_A_1, page: 1, pageSize: 20 }),
		).rejects.toThrow("Not authenticated.");

		expect(holder.settings).toEqual([]);
		expect(holder.events.some((event) => event.startsWith("tx:"))).toBe(false);
	});
});
