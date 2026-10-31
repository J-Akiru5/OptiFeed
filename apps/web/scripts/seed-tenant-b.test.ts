import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
	SEED_TENANT_B_CONFIRM_KEY,
	SEED_TENANT_B_CONFIRM_VALUE,
	assertSeedTarget,
	seedTenantBDemo,
} from "./seed-tenant-b";
import {
	TENANT_B_ADMIN_FARM_ID,
	TENANT_B_DEVICE_MACS,
	TENANT_B_OPERATOR_FARM_ID,
	TENANT_B_POND_IDS,
} from "./tenant-b-demo-data";

/**
 * The Tenant B demo seed (issue #418) writes to the same database the staging
 * deployment uses, so its safety properties are the point of these tests:
 *
 * - the target has to be acknowledged before a non-loopback host is written to;
 * - no delete is ever unscoped, so another tenant's rows can never be reached;
 * - the existing admin account keeps its Supabase identity, and its forced
 *   password change is only cleared when the operator asks for it.
 *
 * The database is a recording double rather than a real one: it captures every
 * call so the assertions can be made on what the seed *would* do.
 */

type Row = Record<string, unknown>;
type Call = { model: string; method: string; args: Row };

const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE_URL = "postgresql://postgres:secret@db.abcdefghijkl.supabase.co:5432/postgres";

/**
 * Every model the seed touches. The double has to answer all of them, so the
 * list is explicit: a missing model would fail the run for the wrong reason.
 */
const SEED_MODELS = [
	"biomassLog",
	"calibrationRun",
	"cropCycle",
	"deviceStateEvent",
	"energyDevice",
	"farm",
	"feedEvent",
	"feedLevelLog",
	"feedRequest",
	"fcrReport",
	"fishSample",
	"membership",
	"membershipPermission",
	"notification",
	"organization",
	"orgSetting",
	"pond",
	"pondEvent",
	"scheduleCommand",
	"user",
	"waterTempLog",
] as const;

const EXISTING_ADMIN = {
	id: "user-admin",
	supabaseId: "sb-admin",
	farmId: TENANT_B_ADMIN_FARM_ID,
	email: `${TENANT_B_ADMIN_FARM_ID}@pond.optifeed.local`,
	displayName: "Tenant B Admin",
	role: "ADMIN",
	mustChangePassword: true,
};

function createPrismaMock(options: { adminExists?: boolean } = {}) {
	const calls: Call[] = [];
	const feedRequests: Row[] = [];
	const biomassLogs: Row[] = [];
	let seq = 0;

	const nextId = (prefix: string) => `${prefix}-${++seq}`;

	function makeModel(name: string, handlers: Record<string, (args: Row) => unknown> = {}) {
		return new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
			get(target, prop) {
				if (typeof prop !== "string") return undefined;
				if (!target[prop]) {
					target[prop] = vi.fn((args: Row = {}) => {
						calls.push({ model: name, method: prop, args: args ?? {} });
						const handler = handlers[prop];
						if (handler) return handler(args ?? {});
						if (prop.startsWith("find")) return [];
						if (prop === "createMany" || prop === "deleteMany") return { count: 0 };
						return { id: nextId(name) };
					});
				}
				return target[prop];
			},
		});
	}

	const handlers: Record<string, Record<string, (args: Row) => unknown>> = {
		user: {
			findUnique: (args) =>
				options.adminExists === false || (args.where as Row)?.farmId !== TENANT_B_ADMIN_FARM_ID
					? null
					: { ...EXISTING_ADMIN },
			update: (args) => ({ ...EXISTING_ADMIN, ...(args.data as Row) }),
			create: (args) => ({ id: nextId("user"), ...((args.data as Row) ?? {}) }),
		},
		membership: {
			findFirst: () => ({ orgId: "org-existing" }),
			upsert: (args) => ({ id: nextId("membership"), ...(args.create as Row) }),
		},
		organization: {
			findUnique: () => ({ id: "org-existing", name: "Tenant B Fisheries" }),
			findFirst: () => ({ id: "org-existing", name: "Tenant B Fisheries" }),
			create: (args) => ({ ...(args.data as Row) }),
		},
		membershipPermission: {
			upsert: (args) => ({ id: nextId("perm"), ...(args.create as Row) }),
		},
		farm: {
			upsert: (args) => ({
				id: `farm-${(args.where as Row)?.ownerId}`,
				...(args.create as Row),
			}),
		},
		orgSetting: {
			upsert: (args) => ({ ...(args.create as Row) }),
		},
		pond: {
			upsert: (args) => ({
				id: (args.create as Row)?.id,
				farmId: (args.create as Row)?.farmId,
			}),
		},
		energyDevice: {
			create: () => ({ id: nextId("device") }),
		},
		cropCycle: {
			create: () => ({ id: nextId("cycle") }),
		},
		feedRequest: {
			createMany: (args) => {
				const rows = ((args.data as Row[]) ?? []).map((row) => ({
					id: nextId("req"),
					...row,
				}));
				feedRequests.push(...rows);
				return { count: rows.length };
			},
			findMany: () => feedRequests,
		},
		biomassLog: {
			createMany: (args) => {
				const rows = ((args.data as Row[]) ?? []).map((row) => ({
					id: nextId("biomass"),
					...row,
				}));
				biomassLogs.push(...rows);
				return { count: rows.length };
			},
			findMany: () => biomassLogs,
		},
	};

	const models = Object.fromEntries(
		SEED_MODELS.map((name) => [name, makeModel(name, handlers[name] ?? {})]),
	) as unknown as PrismaClient;

	return { prisma: models, calls };
}

describe("assertSeedTarget", () => {
	it("accepts a loopback host without an acknowledgement", () => {
		expect(assertSeedTarget({ DATABASE_URL: LOCAL_URL })).toEqual({
			host: "127.0.0.1",
			mode: "local",
		});
	});

	it("refuses a remote host until it is acknowledged", () => {
		expect(() => assertSeedTarget({ DATABASE_URL: REMOTE_URL })).toThrow(/SEED_TENANT_B_CONFIRM/);
		expect(
			assertSeedTarget({
				DATABASE_URL: REMOTE_URL,
				[SEED_TENANT_B_CONFIRM_KEY]: SEED_TENANT_B_CONFIRM_VALUE,
			}),
		).toEqual({ host: "db.abcdefghijkl.supabase.co", mode: "remote" });
	});

	it("refuses a missing or malformed DATABASE_URL", () => {
		expect(() => assertSeedTarget({})).toThrow(/DATABASE_URL is not set/);
		expect(() => assertSeedTarget({ DATABASE_URL: "not-a-url" })).toThrow(/not a valid URL/);
	});
});

describe("seedTenantBDemo", () => {
	const NOW = new Date("2026-10-31T08:00:00.000Z");

	async function run(overrides: { adminExists?: boolean; unlockAdmin?: boolean } = {}) {
		const { prisma, calls } = createPrismaMock({ adminExists: overrides.adminExists });
		const summary = await seedTenantBDemo({
			prisma,
			now: NOW,
			unlockAdmin: overrides.unlockAdmin ?? false,
			ensureAuthUser: async (email) => `sb-${email}`,
		});
		return { calls, summary };
	}

	it("never issues an unscoped delete", async () => {
		const { calls } = await run();
		const deletes = calls.filter((call) => call.method === "deleteMany");
		expect(deletes.length).toBeGreaterThan(0);
		for (const call of deletes) {
			expect(call.args.where, `${call.model}.deleteMany needs a where`).toBeTruthy();
			const where = call.args.where as Row;
			// Every delete is bounded by the demo pond ids or the demo feeders.
			const scoped =
				(where.pondId !== undefined && where.pondId !== null) ||
				where.device !== undefined ||
				where.mac !== undefined;
			expect(scoped, `${call.model}.deleteMany must be scoped`).toBe(true);
		}
	});

	it("deletes only rows belonging to the demo ponds and feeders", async () => {
		const { calls } = await run();
		const pondIds = new Set<string>(Object.values(TENANT_B_POND_IDS));
		for (const call of calls.filter((entry) => entry.method === "deleteMany")) {
			const where = call.args.where as Row;
			const pondFilter = where.pondId as { in?: string[] } | undefined;
			if (pondFilter?.in) {
				for (const id of pondFilter.in) expect(pondIds.has(id)).toBe(true);
			}
			const deviceFilter = where.device as { mac?: { in?: string[] } } | undefined;
			if (deviceFilter?.mac?.in) {
				for (const mac of deviceFilter.mac.in) {
					expect(Object.values(TENANT_B_DEVICE_MACS)).toContain(mac);
				}
			}
			const macFilter = where.mac as { in?: string[] } | undefined;
			if (macFilter?.in) {
				for (const mac of macFilter.in) {
					expect(Object.values(TENANT_B_DEVICE_MACS)).toContain(mac);
				}
			}
		}
	});

	it("keeps the existing admin's Supabase identity", async () => {
		const { calls } = await run();
		const updates = calls.filter((call) => call.model === "user" && call.method === "update");
		expect(updates.length).toBeGreaterThan(0);
		for (const update of updates) {
			expect((update.args.data as Row).supabaseId).toBeUndefined();
		}
	});

	it("leaves the forced password change in place by default", async () => {
		const { calls } = await run();
		const update = calls.find((call) => call.model === "user" && call.method === "update");
		expect((update?.args.data as Row).mustChangePassword).toBeUndefined();
	});

	it("clears the forced password change only when asked", async () => {
		const { calls } = await run({ unlockAdmin: true });
		const update = calls.find((call) => call.model === "user" && call.method === "update");
		expect((update?.args.data as Row).mustChangePassword).toBe(false);
	});

	it("reuses the organization the admin already owns", async () => {
		const { calls, summary } = await run();
		expect(summary.organization.id).toBe("org-existing");
		expect(summary.organization.created).toBe(false);
		const orgCreates = calls.filter(
			(call) => call.model === "organization" && call.method === "create",
		);
		expect(orgCreates).toHaveLength(0);
	});

	it("gives the admin an OWNER membership and the operator an OPERATOR one", async () => {
		const { calls } = await run();
		const memberships = calls.filter(
			(call) => call.model === "membership" && call.method === "upsert",
		);
		const roles = memberships.map((call) => (call.args.create as Row)?.role);
		expect(roles).toContain("OWNER");
		expect(roles).toContain("OPERATOR");
	});

	it("records a revoked control_feeder for the operator", async () => {
		const { calls } = await run();
		const permission = calls.find(
			(call) => call.model === "membershipPermission" && call.method === "upsert",
		);
		expect((permission?.args.create as Row)?.permission).toBe("control_feeder");
		expect((permission?.args.create as Row)?.revokedAt).toBe(NOW);
	});

	it("skips the operator and its pond when the account cannot be created", async () => {
		const { prisma, calls } = createPrismaMock({ adminExists: true });
		const summary = await seedTenantBDemo({
			prisma,
			now: NOW,
			unlockAdmin: false,
			// The admin exists, but there is no Supabase account for the operator
			// and no ensureAuthUser to create one with.
			ensureAuthUser: async (email) => {
				if (email.includes(TENANT_B_OPERATOR_FARM_ID)) throw new Error("no auth account");
				return `sb-${email}`;
			},
		});
		expect(summary.operator).toBeNull();
		expect(summary.ponds.map((pond) => pond.id)).not.toContain("demo-tenant-b-pond-gamma");
		const userCreates = calls.filter((call) => call.model === "user" && call.method === "create");
		expect(userCreates).toHaveLength(0);
	});

	it("does not touch the demo-farmer-1 tenant", async () => {
		const { calls } = await run();
		for (const call of calls) {
			expect(JSON.stringify(call.args)).not.toContain("demo-farmer-1");
		}
	});
});
