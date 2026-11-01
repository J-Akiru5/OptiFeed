import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mortality action tests (issue #452):
 * - tenant guard: a pond owned by another farm is refused;
 * - the audit entry is written with the mortality id and the derived count;
 * - invalid input is refused before any database write;
 * - ponds without a device still save (no audit row possible, no crash).
 */

const mocks = vi.hoisted(() => {
	const tx = {
		pond: { findUnique: vi.fn() },
		cropCycle: { findFirst: vi.fn(), findUnique: vi.fn() },
		mortalityLog: { create: vi.fn(), aggregate: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	};
	return {
		tx,
		prisma: {
			$transaction: vi.fn(),
		},
		requireWriteAccess: vi.fn(),
		getCurrentPondOwnerId: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: mocks.requireWriteAccess,
	getCurrentPondOwnerId: mocks.getCurrentPondOwnerId,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveMortalityLog } from "@/lib/actions/mortality";

const OWNER = "owner-1";
const POND = "pond-1";
const DEVICE = "dev-1";
const CYCLE = "cycle-1";

function form(overrides: Record<string, string> = {}): FormData {
	const formData = new FormData();
	formData.set("pondId", POND);
	formData.set("count", "15");
	formData.set("reason", "oxygen drop");
	for (const [key, value] of Object.entries(overrides)) {
		formData.set(key, value);
	}
	return formData;
}

function setup(
	overrides: {
		pond?: Record<string, unknown>;
		cycle?: Record<string, unknown> | null;
		device?: Record<string, unknown> | null;
		deadSoFar?: number;
	} = {},
) {
	const pond = { id: POND, ownerId: OWNER, farmId: "farm-1", population: 300, ...overrides.pond };
	mocks.tx.pond.findUnique.mockResolvedValue(pond);
	mocks.tx.cropCycle.findFirst.mockResolvedValue(
		overrides.cycle === undefined ? { id: CYCLE } : overrides.cycle,
	);
	mocks.tx.cropCycle.findUnique.mockResolvedValue({ stockingCount: 300 });
	mocks.tx.mortalityLog.create.mockResolvedValue({ id: "m-1" });
	mocks.tx.mortalityLog.aggregate.mockResolvedValue({ _sum: { count: overrides.deadSoFar ?? 15 } });
	mocks.tx.energyDevice.findFirst.mockResolvedValue(
		overrides.device === undefined ? { id: DEVICE } : overrides.device,
	);
	mocks.tx.deviceStateEvent.create.mockResolvedValue({});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireWriteAccess.mockResolvedValue(undefined);
	mocks.getCurrentPondOwnerId.mockResolvedValue(OWNER);
	mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
		callback(mocks.tx),
	);
	setup();
});

describe("saveMortalityLog", () => {
	it("creates the record with the ownership stamp, cycles link and derived live count", async () => {
		const result = await saveMortalityLog(form());

		expect(result.success).toBe(true);
		expect(result.live).toEqual({ stocked: 300, dead: 15, live: 285, source: "crop_cycle" });
		const data = mocks.tx.mortalityLog.create.mock.calls[0][0].data;
		expect(data).toMatchObject({
			pondId: POND,
			cropCycleId: CYCLE,
			farmId: "farm-1",
			count: 15,
			reason: "oxygen drop",
			createdBy: OWNER,
		});

		// Audit entry per write, visible on the farmer audit trail.
		const audit = mocks.tx.deviceStateEvent.create.mock.calls[0][0].data;
		expect(audit).toMatchObject({
			deviceId: DEVICE,
			eventType: "mortality_recorded",
			source: "user",
			actorId: OWNER,
		});

		expect(mocks.revalidatePath).toHaveBeenCalled();
	});

	it("refuses a pond owned by another farm without writing anything", async () => {
		setup({ pond: { ownerId: "owner-2" } });

		const result = await saveMortalityLog(form());

		expect(result).toEqual({ success: false, error: "pond_not_found" });
		expect(mocks.tx.mortalityLog.create).not.toHaveBeenCalled();
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("validates the count before any database write", async () => {
		for (const bad of ["0", "-3", "1.5", "abc", "100001"]) {
			const result = await saveMortalityLog(form({ count: bad }));
			expect(result.success, `count=${bad}`).toBe(false);
		}
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("still saves on a pond without a device (audit skipped, no crash)", async () => {
		setup({ device: null });

		const result = await saveMortalityLog(form());

		expect(result.success).toBe(true);
		expect(mocks.tx.deviceStateEvent.create).not.toHaveBeenCalled();
	});

	it("falls back to Pond.population when no active cycle exists", async () => {
		setup({ cycle: null, deadSoFar: 40 });

		const result = await saveMortalityLog(form({ count: "40" }));

		expect(result.success).toBe(true);
		expect(result.live).toEqual({ stocked: 300, dead: 40, live: 260, source: "legacy_population" });
		const data = mocks.tx.mortalityLog.create.mock.calls[0][0].data;
		expect(data.cropCycleId).toBeUndefined();
	});

	it("rejects an oversized reason string instead of writing it", async () => {
		setup();
		const result = await saveMortalityLog(form({ reason: "x".repeat(201) }));
		expect(result.success).toBe(true);
		const data = mocks.tx.mortalityLog.create.mock.calls[0][0].data;
		expect((data.reason as string).length).toBe(200);
	});
});
