import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const executeRaw = vi.fn(async () => 1);
	const tx = { $executeRaw: executeRaw };
	const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
	return { executeRaw, tx, transaction };
});

vi.mock("@/lib/prisma", () => ({
	default: { $transaction: mocks.transaction },
}));

import { tenantConfigEntries, withTenant } from "@/lib/db/tenant-context";

const CONTEXT = {
	farmIds: ["farm-a", "farm-b"],
	pondIds: ["pond-1", "pond-2"],
	userId: "user-1",
	supabaseId: "supabase-1",
	orgIds: ["org-1"],
};

describe("tenant context (#711 Phase 2)", () => {
	it("produces the settings in a stable order", () => {
		expect(tenantConfigEntries(CONTEXT)).toEqual([
			{ key: "app.farm_ids", value: "farm-a,farm-b" },
			{ key: "app.pond_ids", value: "pond-1,pond-2" },
			{ key: "app.user_id", value: "user-1" },
			{ key: "app.supabase_id", value: "supabase-1" },
			{ key: "app.org_ids", value: "org-1" },
		]);
	});

	it("omits empty settings instead of writing empty arrays", () => {
		expect(
			tenantConfigEntries({
				farmIds: [],
				pondIds: [],
				userId: "user-1",
				supabaseId: "supabase-1",
				orgIds: [],
			}),
		).toEqual([
			{ key: "app.user_id", value: "user-1" },
			{ key: "app.supabase_id", value: "supabase-1" },
		]);
	});

	it("runs the work inside a transaction with every setting applied", async () => {
		mocks.executeRaw.mockClear();
		mocks.transaction.mockClear();

		const result = await withTenant(CONTEXT, async (tx) => {
			expect(tx).toBe(mocks.tx);
			return "done";
		});

		expect(result).toBe("done");
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
		expect(mocks.executeRaw).toHaveBeenCalledTimes(5);

		const calls = mocks.executeRaw.mock.calls as unknown[][];
		expect(calls.map((call) => call[1])).toEqual([
			"app.farm_ids",
			"app.pond_ids",
			"app.user_id",
			"app.supabase_id",
			"app.org_ids",
		]);
		expect(calls.map((call) => call[2])).toEqual([
			"farm-a,farm-b",
			"pond-1,pond-2",
			"user-1",
			"supabase-1",
			"org-1",
		]);
	});
});
