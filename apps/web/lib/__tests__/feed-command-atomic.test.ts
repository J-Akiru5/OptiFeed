import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/device-status", () => ({
	getDeviceStatusPolicy: vi.fn(async () => ({
		weakAfterMin: 4,
		offlineAfterMin: 5,
		offlineGraceMin: 0,
	})),
}));

vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({
		dailyCapFactor: 1,
		maxDispenseMs: 300_000,
	})),
}));

import type { CommandDb, ManualFeedOutcome } from "@/lib/feed/commands";
import { createManualFeedRequest } from "@/lib/feed/commands";
import {
	DEVICE_A_1,
	FARM_A,
	type TenancyClient,
	type TenancyDb,
	type TenancyFeedRequest,
	createTenancyDb,
} from "./helpers/tenancy";
import { type TestPrismaClient, createTestPrisma } from "./helpers/test-prisma";

/**
 * #581: the manual "Feed now" path is one atomic decision.
 *
 * These tests use the shared Prisma double, whose `$queryRaw` acquires a real
 * serialization lock for `SELECT ... FOR UPDATE` and whose `feedRequest.create`
 * enforces the partial unique index from the migration. They therefore prove
 * the lock/cap/insert ordering instead of stubbing the race away.
 */

const INPUT = {
	deviceId: DEVICE_A_1,
	grams: 150,
	farmId: FARM_A,
	actorId: FARM_A,
	triggerSource: "feed-command-atomic-test",
};

type OkOutcome = Extract<ManualFeedOutcome, { ok: true }>;
type RefusedOutcome = Extract<ManualFeedOutcome, { ok: false }>;

function accepted(outcomes: ManualFeedOutcome[]): OkOutcome[] {
	return outcomes.filter((outcome): outcome is OkOutcome => outcome.ok);
}

function refused(outcomes: ManualFeedOutcome[]): RefusedOutcome[] {
	return outcomes.filter((outcome): outcome is RefusedOutcome => !outcome.ok);
}

function setup(options: { dailyCapG?: number | null } = {}) {
	const db = createTenancyDb();
	const device = db.tables.energyDevices.find((row) => row.id === DEVICE_A_1);
	if (!device) throw new Error(`fixture device ${DEVICE_A_1} is missing`);
	device.lastSeenAt = new Date();
	device.dailyCapG = options.dailyCapG ?? null;

	const rawClient = createTestPrisma(db);
	return { db, rawClient, client: rawClient as unknown as CommandDb };
}

function seedRequest(
	db: TenancyDb,
	overrides: Partial<TenancyFeedRequest> & { id: string },
): TenancyFeedRequest {
	const request: TenancyFeedRequest = {
		deviceId: DEVICE_A_1,
		grams: 100,
		status: "completed",
		kind: "feed",
		createdAt: new Date(),
		updatedAt: new Date(),
		farmId: null,
		...overrides,
	};
	db.tables.feedRequests.push(request);
	return request;
}

function manualAudits(db: TenancyDb) {
	return db.tables.deviceStateEvents.filter(
		(row) => row.deviceId === DEVICE_A_1 && row.eventType === "manual_trigger",
	);
}

describe("createManualFeedRequest atomicity", () => {
	it("creates exactly one request and one audit row when two calls race", async () => {
		const { db, client } = setup();

		const outcomes = await Promise.all([
			createManualFeedRequest(client, INPUT),
			createManualFeedRequest(client, INPUT),
		]);

		const created = accepted(outcomes).filter((outcome) => !outcome.alreadyPending);
		const duplicates = accepted(outcomes).filter((outcome) => outcome.alreadyPending);

		expect(created).toHaveLength(1);
		expect(duplicates).toHaveLength(1);
		expect(db.tables.feedRequests).toHaveLength(1);
		expect(db.tables.feedRequests[0]).toMatchObject({
			deviceId: DEVICE_A_1,
			grams: 150,
			status: "pending",
		});
		expect(duplicates[0].requestId).toBe(db.tables.feedRequests[0].id);
		expect(manualAudits(db)).toHaveLength(1);
	});

	it("refuses the concurrent dose that would cross the daily ceiling", async () => {
		const { db, rawClient, client } = setup({ dailyCapG: 1000 });
		seedRequest(db, { id: "already-fed", grams: 800, status: "completed" });

		// Simulate the device consuming the first dose before that transaction
		// commits: the row becomes completed while the device lock is still held,
		// so the second caller evaluates the cap against the real post-dose total
		// rather than the same pre-insert aggregate.
		const firstClient = {
			...rawClient,
			$transaction: <T>(fn: (tx: TenancyClient) => Promise<T>) =>
				db.runTransaction(async (tx) => {
					const result = await fn(tx);
					const outcome = result as unknown as { ok?: boolean; requestId?: string };
					if (outcome.ok === true) {
						const row = db.tables.feedRequests.find(
							(candidate) => candidate.id === outcome.requestId,
						);
						if (row) row.status = "completed";
					}
					return result;
				}),
		} as TestPrismaClient;

		const outcomes = await Promise.all([
			createManualFeedRequest(firstClient as unknown as CommandDb, INPUT),
			createManualFeedRequest(client, INPUT),
		]);

		expect(accepted(outcomes).filter((outcome) => !outcome.alreadyPending)).toHaveLength(1);
		const capRefusals = refused(outcomes).filter((outcome) => outcome.code === "daily_cap");
		expect(capRefusals).toHaveLength(1);

		const total = db.tables.feedRequests.reduce((sum, row) => sum + row.grams, 0);
		expect(total).toBe(950);
		expect(total).toBeLessThanOrEqual(1000);
		expect(db.tables.feedRequests.filter((row) => row.status === "pending")).toHaveLength(0);
	});

	it("returns the winning request when a non-locking writer beats the insert", async () => {
		const { db, rawClient, client } = setup();
		const delegate = rawClient.feedRequest;
		const originalFindFirst = delegate.findFirst;
		let calls = 0;

		const spy = vi.spyOn(delegate, "findFirst").mockImplementation(async (args) => {
			calls += 1;
			if (calls === 1) {
				// The in-transaction pending check passes, then a writer that does not
				// take the device lock (for example a calibration request) commits a
				// pending row before our insert reaches the unique index.
				seedRequest(db, { id: "concurrent-winner", grams: 100, status: "pending" });
				return null;
			}
			return originalFindFirst(args);
		});

		try {
			const outcome = await createManualFeedRequest(client, INPUT);

			expect(outcome).toEqual({
				ok: true,
				requestId: "concurrent-winner",
				alreadyPending: true,
			});
			expect(db.tables.feedRequests.map((row) => row.id)).toEqual(["concurrent-winner"]);
			expect(manualAudits(db)).toHaveLength(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("keeps the dispatched in-progress guard and writes no audit row", async () => {
		const { db, client } = setup();
		seedRequest(db, { id: "in-flight", grams: 150, status: "dispatched" });

		const outcome = await createManualFeedRequest(client, INPUT);

		expect(outcome).toMatchObject({ ok: false, code: "in_progress" });
		expect(db.tables.feedRequests).toHaveLength(1);
		expect(manualAudits(db)).toHaveLength(0);
	});

	it("still queues a single request with its audit row", async () => {
		const { db, client } = setup();

		const outcome = await createManualFeedRequest(client, INPUT);

		expect(outcome).toMatchObject({ ok: true, alreadyPending: false });
		expect(db.tables.feedRequests).toHaveLength(1);
		const audits = manualAudits(db);
		expect(audits).toHaveLength(1);
		expect(audits[0].metadata).toMatchObject({
			grams: 150,
			triggerSource: "feed-command-atomic-test",
		});
	});
});
