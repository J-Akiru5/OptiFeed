import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/device-status", () => ({
	getDeviceStatusPolicy: vi.fn(async () => ({
		weakAfterMin: 4,
		offlineAfterMin: 5,
		offlineGraceMin: 0,
	})),
}));

vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ dailyCapFactor: 1 })),
}));

import { createManualFeedRequest } from "@/lib/feed/commands";
import type { CommandDb } from "@/lib/feed/commands";

/**
 * A feeder in safe mode refuses every dose. Queueing one anyway only strands it
 * as "in progress", so the server says so up front.
 */

function fakeDb(healthMetadata: unknown | null) {
	const feedRequestCreate = vi.fn(async () => ({ id: "req-1" }));
	const db = {
		energyDevice: {
			findFirst: vi.fn(async () => ({
				gramsPerFeeding: 150,
				gramsPerSecond: 4,
				lastSeenAt: new Date(),
				hopperCapacityG: null,
				dailyCapG: null,
				pond: { isFallow: false },
			})),
			update: vi.fn(async () => ({})),
		},
		feedRequest: {
			updateMany: vi.fn(async () => ({ count: 0 })),
			findFirst: vi.fn(async () => null),
			aggregate: vi.fn(async () => ({ _sum: { grams: 0 } })),
			create: feedRequestCreate,
		},
		deviceStateEvent: {
			findFirst: vi.fn(async () => (healthMetadata === null ? null : { metadata: healthMetadata })),
			create: vi.fn(async () => ({})),
		},
	};
	return { db: db as unknown as CommandDb, feedRequestCreate };
}

const INPUT = { deviceId: "dev-1", actorId: "farm-1", triggerSource: "dashboard" };

describe("createManualFeedRequest and safe mode", () => {
	it("refuses with a safe_mode code and queues nothing", async () => {
		const { db, feedRequestCreate } = fakeDb({
			safeMode: true,
			faultsPresent: 16,
			faultsLatched: 16,
		});

		const outcome = await createManualFeedRequest(db, INPUT);

		expect(outcome).toMatchObject({ ok: false, code: "safe_mode" });
		if (!outcome.ok) expect(outcome.error).toContain("safe mode");
		expect(feedRequestCreate).not.toHaveBeenCalled();
	});

	it("queues the dose once the latest health row says safe mode is over", async () => {
		const { db, feedRequestCreate } = fakeDb({
			safeMode: false,
			faultsPresent: 0,
			faultsLatched: 0,
		});

		const outcome = await createManualFeedRequest(db, INPUT);

		expect(outcome).toMatchObject({ ok: true });
		expect(feedRequestCreate).toHaveBeenCalledTimes(1);
	});

	it("treats a unit that never reported health as healthy", async () => {
		const { db, feedRequestCreate } = fakeDb(null);

		const outcome = await createManualFeedRequest(db, INPUT);

		expect(outcome).toMatchObject({ ok: true });
		expect(feedRequestCreate).toHaveBeenCalledTimes(1);
	});
});
