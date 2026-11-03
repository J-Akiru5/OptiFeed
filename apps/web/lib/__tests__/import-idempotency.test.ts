import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #723: confirm is a single unique action, not an "insert every time" call.
 *
 * The confirmation row is written in the same transaction as the imported
 * rows: a replay returns the stored result, a failed insert leaves no key
 * behind, and a concurrent duplicate loses the unique race without committing
 * its own rows.
 */

const { resolveActivePond, prisma, tx } = vi.hoisted(() => {
	const tx = {
		biomassLog: { createMany: vi.fn() },
		fishSample: { createMany: vi.fn() },
		feedEvent: { createMany: vi.fn() },
		fcrReport: { createMany: vi.fn() },
		feedLevelLog: { createMany: vi.fn() },
		notification: { createMany: vi.fn() },
		deviceStateEvent: { createMany: vi.fn(), create: vi.fn() },
		importConfirmation: { create: vi.fn() },
	};
	const prisma = {
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		importConfirmation: { findUnique: vi.fn() },
		$transaction: vi.fn(),
	};
	return { resolveActivePond: vi.fn(), prisma, tx };
});

vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({ default: prisma }));

import { confirmImport } from "@/lib/jobs/import-data";

const CSV = "sampleWeightKg,sampleCount\n10,5";
const OTHER_CSV = "sampleWeightKg,sampleCount\n12,6";

interface ConfirmationWhere {
	ownerId_idempotencyKey: { ownerId: string; idempotencyKey: string };
}

interface ConfirmationData {
	ownerId: string;
	idempotencyKey: string;
	result: { importedCount: number };
}

const store = new Map<string, { importedCount: number }>();

function storeKey(where: ConfirmationWhere): string {
	const { ownerId, idempotencyKey } = where.ownerId_idempotencyKey;
	return `${ownerId}\0${idempotencyKey}`;
}

beforeEach(() => {
	vi.clearAllMocks();
	store.clear();

	resolveActivePond.mockResolvedValue({ id: "pond-1" });
	prisma.energyDevice.findFirst.mockResolvedValue({ id: "dev-1" });
	prisma.biomassLog.findMany.mockResolvedValue([]);
	prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<number>) =>
		fn(tx),
	);

	tx.biomassLog.createMany.mockResolvedValue({ count: 2 });
	tx.deviceStateEvent.create.mockResolvedValue({});

	// A tiny in-memory stand-in for the unique (ownerId, idempotencyKey) row.
	prisma.importConfirmation.findUnique.mockImplementation(
		async ({ where }: { where: ConfirmationWhere }) => {
			const result = store.get(storeKey(where));
			return result ? { result } : null;
		},
	);
	tx.importConfirmation.create.mockImplementation(
		async ({ data }: { data: ConfirmationData }) => {
			const key = `${data.ownerId}\0${data.idempotencyKey}`;
			if (store.has(key)) {
				throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
			}
			store.set(key, data.result);
			return data;
		},
	);
});

describe("confirmImport idempotency (#723)", () => {
	it("returns the first result and performs no second insert for a repeated key", async () => {
		const first = await confirmImport("farm-a", "biomass_logs", CSV, {
			idempotencyKey: "confirm-key-1",
		});
		const replay = await confirmImport("farm-a", "biomass_logs", CSV, {
			idempotencyKey: "confirm-key-1",
		});

		expect(first).toEqual({ importedCount: 2 });
		expect(replay).toEqual(first);
		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(1);
		expect(prisma.$transaction).toHaveBeenCalledTimes(1);
	});

	it("inserts again when the same payload is confirmed with a different key", async () => {
		await confirmImport("farm-a", "biomass_logs", CSV, { idempotencyKey: "confirm-key-1" });
		await confirmImport("farm-a", "biomass_logs", CSV, { idempotencyKey: "confirm-key-2" });

		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(2);
		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
	});

	it("does not leave a consumed key when the insert fails, so a retry imports", async () => {
		tx.biomassLog.createMany.mockRejectedValueOnce(new Error("insert failed"));

		await expect(
			confirmImport("farm-a", "biomass_logs", CSV, { idempotencyKey: "retry-key" }),
		).rejects.toThrow("insert failed");
		// The confirmation is created after the rows, in the same transaction,
		// so the failed attempt never reached it.
		expect(tx.importConfirmation.create).not.toHaveBeenCalled();

		const retried = await confirmImport("farm-a", "biomass_logs", CSV, {
			idempotencyKey: "retry-key",
		});

		expect(retried).toEqual({ importedCount: 2 });
		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(2);
		expect(tx.importConfirmation.create).toHaveBeenCalledTimes(1);
	});

	it("derives a stable payload hash when no client key is supplied", async () => {
		const first = await confirmImport("farm-a", "biomass_logs", CSV);
		const replay = await confirmImport("farm-a", "biomass_logs", CSV);

		expect(replay).toEqual(first);
		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(1);

		const where = prisma.importConfirmation.findUnique.mock.calls[0]?.[0].where as ConfirmationWhere;
		expect(where.ownerId_idempotencyKey.idempotencyKey).toMatch(/^payload-sha256:[a-f0-9]{64}$/);

		// A different payload is a different action, so it still imports.
		await confirmImport("farm-a", "biomass_logs", OTHER_CSV);
		expect(tx.biomassLog.createMany).toHaveBeenCalledTimes(2);
	});

	it("returns the winner's result when two confirms race the unique index", async () => {
		const winner = await confirmImport("farm-a", "biomass_logs", CSV, {
			idempotencyKey: "race-key",
		});

		// Force the loser to miss the pre-check, as a concurrent request would.
		prisma.importConfirmation.findUnique.mockResolvedValueOnce(null);
		const loser = await confirmImport("farm-a", "biomass_logs", CSV, {
			idempotencyKey: "race-key",
		});

		expect(loser).toEqual(winner);
		// The loser ran a transaction and hit P2002; in Postgres that rolls its
		// inserted rows back, so only the winner's set is committed.
		expect(tx.importConfirmation.create).toHaveBeenCalledTimes(2);
		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
	});
});
