import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boundary proof for the request-scoped tenant context (#711, option B).
 *
 * These tests exercise the real `AsyncLocalStorage` plumbing, but the database
 * is a double: it records the `set_config` calls and the queries a real
 * transaction would receive. They prove the ordering and the client identity,
 * not that Postgres accepted a setting or that `optifeed_app` sees fewer rows —
 * that needs the two-tenant proof against a real database.
 */

const mocks = vi.hoisted(() => {
	type Tx = {
		$executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
		pond: { findMany: (args: unknown) => Promise<unknown[]> };
	};
	type Recorded = { tx: Tx; events: string[] };

	const transactions: Recorded[] = [];
	const transaction = vi.fn(async (work: (tx: Tx) => Promise<unknown>) => {
		const events: string[] = [];
		const tx: Tx = {
			$executeRaw: async (_strings, ...values) => {
				events.push(`set_config:${String(values[0])}`);
				return 1;
			},
			pond: {
				findMany: async () => {
					events.push("query:pond.findMany");
					return [];
				},
			},
		};
		transactions.push({ tx, events });
		return work(tx);
	});

	return { transaction, transactions };
});

vi.mock("@/lib/prisma", () => ({ default: { $transaction: mocks.transaction } }));

import {
	MissingTenantContextError,
	getTenantContext,
	runWithTenant,
	tenantPrisma,
	withTenant,
} from "@/lib/db/tenant-context";

const CONTEXT = {
	farmIds: ["farm-a"],
	pondIds: ["pond-1"],
	userId: "user-1",
	supabaseId: "supabase-1",
	orgIds: ["org-1"],
};

describe("tenantPrisma", () => {
	beforeEach(() => {
		mocks.transaction.mockClear();
		mocks.transactions.length = 0;
	});

	it("throws MissingTenantContextError instead of returning the privileged client", () => {
		expect(getTenantContext()).toBeNull();
		expect(() => tenantPrisma()).toThrow(MissingTenantContextError);
		expect(() => tenantPrisma()).toThrow(/outside runWithTenant/);
	});

	it("returns the transaction client that runWithTenant opened", async () => {
		const result = await runWithTenant(CONTEXT, async (tx) => {
			expect(tenantPrisma()).toBe(tx);
			expect(getTenantContext()).toEqual(CONTEXT);
			return "done";
		});

		expect(result).toBe("done");
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
		// The context does not outlive the request that created it.
		expect(tenantPrisma).toThrow(MissingTenantContextError);
	});

	it("runs a tenantPrisma query on the transaction that already applied set_config", async () => {
		await runWithTenant(CONTEXT, async () => {
			await tenantPrisma().pond.findMany({ where: { ownerId: "farm-a" } });
		});

		const [recorded] = mocks.transactions;
		expect(recorded?.events).toEqual([
			"set_config:app.farm_ids",
			"set_config:app.pond_ids",
			"set_config:app.user_id",
			"set_config:app.supabase_id",
			"set_config:app.org_ids",
			"query:pond.findMany",
		]);
	});

	it("keeps concurrent contexts on their own transaction", async () => {
		let openA: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			openA = resolve;
		});
		let txA: unknown;

		const first = runWithTenant({ ...CONTEXT, farmIds: ["farm-a"] }, async (tx) => {
			txA = tx;
			expect(getTenantContext()?.farmIds).toEqual(["farm-a"]);
			await gate;
			// Still farm A after the second request started and awaited.
			expect(getTenantContext()?.farmIds).toEqual(["farm-a"]);
			expect(tenantPrisma()).toBe(txA);
			return "a";
		});

		const second = runWithTenant({ ...CONTEXT, farmIds: ["farm-b"] }, async () => {
			expect(getTenantContext()?.farmIds).toEqual(["farm-b"]);
			openA();
			return "b";
		});

		await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
		expect(mocks.transactions).toHaveLength(2);
		expect(getTenantContext()).toBeNull();
	});

	it("publishes the context through the deprecated withTenant alias", async () => {
		await withTenant(CONTEXT, async (tx) => {
			expect(tenantPrisma()).toBe(tx);
			expect(getTenantContext()).toEqual(CONTEXT);
		});

		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(tenantPrisma).toThrow(MissingTenantContextError);
	});
});
