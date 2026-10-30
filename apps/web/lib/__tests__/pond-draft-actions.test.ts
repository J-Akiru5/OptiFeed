import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/actions/pond-draft.ts` (I-99).
 *
 * The draft is a browser-supplied JSON blob written on behalf of one user for
 * one pond, so the tests sit on the three boundaries that matter:
 *
 *  - authorization: every action runs the same guard as saving pond settings and
 *    re-checks the pond's tenant scope (allow and deny, nothing read on deny);
 *  - input: an oversized payload is refused, unknown keys are stripped, and a
 *    non-object is rejected before any write;
 *  - restore precedence: a draft is returned only when it is newer than the
 *    saved settings and differs from them, and only for its own user.
 */

const { db } = vi.hoisted(() => {
	const db = {
		pond: { findFirst: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		pondSettingsDraft: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
			deleteMany: vi.fn(),
		},
		deviceStateEvent: { findFirst: vi.fn() },
		scheduleCommand: { findFirst: vi.fn() },
	};
	return { db };
});

const session = vi.hoisted(() => ({
	requireWriteAccess: vi.fn(),
	getCurrentPondOwnerId: vi.fn(),
	getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => ({ feedingRatePct: 2, feedsPerDay: 2 })),
}));

import {
	discardPondSettingsDraft,
	loadPondSettingsDraft,
	savePondSettingsDraft,
} from "@/lib/actions/pond-draft";
import { POND_SETTINGS_DRAFT_MAX_BYTES } from "@/lib/settings/pond-draft-schema";

const mockPond = vi.mocked(db.pond);
const mockDevice = vi.mocked(db.energyDevice);
const mockDraft = vi.mocked(db.pondSettingsDraft);
const mockEvent = vi.mocked(db.deviceStateEvent);
const mockCommand = vi.mocked(db.scheduleCommand);
const mockGuard = vi.mocked(session.requireWriteAccess);
const mockOwner = vi.mocked(session.getCurrentPondOwnerId);
const mockUser = vi.mocked(session.getCurrentUser);

const POND = {
	id: "pond-1",
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	feedingRatePct: 2,
	feedsPerDay: 2,
	sampleIntervalDays: 15,
	population: 100,
	notificationPrefs: {
		profile: { areaM2: 500, averageDepthM: 1.5, feedPricePerKg: 30 },
	},
};

/** Exactly the values the form starts from for POND above. */
const SAVED_VALUES = {
	feedingRate: "2",
	feedsPerDay: "2",
	sampleInterval: "15",
	population: "100",
	areaM2: "500",
	averageDepthM: "1.5",
	feedPricePerKg: "30",
};

const TYPED_VALUES = {
	feedingRate: "3.5",
	feedsPerDay: "4",
	sampleInterval: "20",
	population: "150",
	areaM2: "600",
	averageDepthM: "2",
	feedPricePerKg: "40",
};

function allow() {
	mockGuard.mockResolvedValue(undefined);
	mockOwner.mockResolvedValue("farm-a");
	mockUser.mockResolvedValue({ id: "user-1" } as never);
	mockPond.findFirst.mockResolvedValue(POND as never);
	mockDevice.findFirst.mockResolvedValue({ id: "device-1" } as never);
	mockDraft.upsert.mockResolvedValue({ updatedAt: new Date("2026-10-30T09:00:00.000Z") } as never);
	mockDraft.deleteMany.mockResolvedValue({ count: 1 } as never);
	mockEvent.findFirst.mockResolvedValue(null);
	mockCommand.findFirst.mockResolvedValue(null);
}

function deny() {
	mockGuard.mockRejectedValue(new Error("Write access required (ADMIN or OPERATOR)"));
}

beforeEach(() => {
	vi.clearAllMocks();
	allow();
});

describe("savePondSettingsDraft", () => {
	it("upserts the typed values for the caller and the pond's device", async () => {
		const result = await savePondSettingsDraft("pond-1", TYPED_VALUES);

		expect(result).toEqual({ success: true, savedAt: "2026-10-30T09:00:00.000Z" });
		expect(mockDraft.upsert).toHaveBeenCalledWith({
			where: { pondId_userId: { pondId: "pond-1", userId: "user-1" } },
			create: {
				pondId: "pond-1",
				userId: "user-1",
				deviceId: "device-1",
				data: TYPED_VALUES,
			},
			update: { deviceId: "device-1", data: TYPED_VALUES },
			select: { updatedAt: true },
		});
	});

	it("stores null when the pond has no device", async () => {
		mockDevice.findFirst.mockResolvedValue(null);

		await savePondSettingsDraft("pond-1", TYPED_VALUES);

		expect(mockDraft.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ create: expect.objectContaining({ deviceId: null }) }),
		);
	});

	it("denies a caller without write access and reads nothing", async () => {
		deny();

		const result = await savePondSettingsDraft("pond-1", TYPED_VALUES);

		expect(result.success).toBe(false);
		expect(mockPond.findFirst).not.toHaveBeenCalled();
		expect(mockDraft.upsert).not.toHaveBeenCalled();
	});

	it("denies a pond outside the caller's scope", async () => {
		mockPond.findFirst.mockResolvedValue(null);

		const result = await savePondSettingsDraft("pond-other", TYPED_VALUES);

		expect(result).toEqual({ success: false, error: "Pond not found" });
		expect(mockPond.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "pond-other", ownerId: "farm-a" } }),
		);
		expect(mockDraft.upsert).not.toHaveBeenCalled();
	});

	it("refuses a payload over the 8 KB limit", async () => {
		const oversized = { ...TYPED_VALUES, population: "1".repeat(POND_SETTINGS_DRAFT_MAX_BYTES) };

		const result = await savePondSettingsDraft("pond-1", oversized);

		expect(result).toEqual({ success: false, error: "The draft is too large to keep" });
		expect(mockDraft.upsert).not.toHaveBeenCalled();
	});

	it("accepts and strips unknown padding while the payload stays under the limit", async () => {
		// ~7 KB of unknown keys: inside 8 KB on the wire, stripped before storage.
		const padded = { ...TYPED_VALUES, padding: "x".repeat(7000) };
		expect(Buffer.byteLength(JSON.stringify(padded), "utf8")).toBeLessThan(
			POND_SETTINGS_DRAFT_MAX_BYTES,
		);

		const result = await savePondSettingsDraft("pond-1", padded);

		expect(result.success).toBe(true);
		const call = mockDraft.upsert.mock.calls[0][0] as {
			create: { data: Record<string, unknown> };
		};
		expect(call.create.data).toEqual(TYPED_VALUES);
	});

	it("strips unknown keys instead of storing them", async () => {
		const result = await savePondSettingsDraft("pond-1", {
			...TYPED_VALUES,
			secretToken: "do-not-store",
			password: "do-not-store",
		});

		expect(result.success).toBe(true);
		const call = mockDraft.upsert.mock.calls[0][0] as {
			create: { data: Record<string, unknown> };
		};
		expect(call.create.data).toEqual(TYPED_VALUES);
		expect(JSON.stringify(call.create.data)).not.toContain("do-not-store");
	});

	it("rejects a non-object or non-string payload", async () => {
		expect((await savePondSettingsDraft("pond-1", "not a draft")).success).toBe(false);
		expect(
			(await savePondSettingsDraft("pond-1", { ...TYPED_VALUES, population: 150 })).success,
		).toBe(false);
		expect(mockDraft.upsert).not.toHaveBeenCalled();
	});
});

describe("loadPondSettingsDraft", () => {
	function storedDraft(data: unknown, updatedAt: string) {
		mockDraft.findUnique.mockResolvedValue({
			data,
			updatedAt: new Date(updatedAt),
			deviceId: "device-1",
		} as never);
	}

	it("returns a draft newer than the saved settings that differs from them", async () => {
		mockEvent.findFirst.mockResolvedValue({
			createdAt: new Date("2026-10-30T08:00:00.000Z"),
		} as never);
		storedDraft(TYPED_VALUES, "2026-10-30T09:00:00.000Z");

		const result = await loadPondSettingsDraft("pond-1");

		expect(result).toEqual({
			success: true,
			draft: {
				values: TYPED_VALUES,
				updatedAt: "2026-10-30T09:00:00.000Z",
				deviceId: "device-1",
			},
		});
	});

	it("reads only the caller's own row", async () => {
		mockDraft.findUnique.mockResolvedValue(null);

		await loadPondSettingsDraft("pond-1");

		expect(mockDraft.findUnique).toHaveBeenCalledWith({
			where: { pondId_userId: { pondId: "pond-1", userId: "user-1" } },
			select: { data: true, updatedAt: true, deviceId: true },
		});
	});

	it("ignores a draft overtaken by a saved settings change", async () => {
		mockEvent.findFirst.mockResolvedValue({
			createdAt: new Date("2026-10-30T10:00:00.000Z"),
		} as never);
		storedDraft(TYPED_VALUES, "2026-10-30T09:00:00.000Z");

		expect(await loadPondSettingsDraft("pond-1")).toEqual({ success: true, draft: null });
	});

	it("ignores a draft overtaken by a newer schedule command", async () => {
		mockCommand.findFirst.mockResolvedValue({
			createdAt: new Date("2026-10-30T10:00:00.000Z"),
		} as never);
		storedDraft(TYPED_VALUES, "2026-10-30T09:00:00.000Z");

		expect(await loadPondSettingsDraft("pond-1")).toEqual({ success: true, draft: null });
	});

	it("ignores a draft equal to the saved values (a stale copy after a save)", async () => {
		storedDraft(SAVED_VALUES, "2026-10-30T09:00:00.000Z");

		expect(await loadPondSettingsDraft("pond-1")).toEqual({ success: true, draft: null });
	});

	it("ignores a corrupted stored payload instead of showing it", async () => {
		storedDraft({ feedingRate: 1, nope: true }, "2026-10-30T09:00:00.000Z");

		expect(await loadPondSettingsDraft("pond-1")).toEqual({ success: true, draft: null });
	});

	it("returns null when there is no draft", async () => {
		mockDraft.findUnique.mockResolvedValue(null);

		expect(await loadPondSettingsDraft("pond-1")).toEqual({ success: true, draft: null });
	});

	it("denies a caller without write access and reads nothing", async () => {
		deny();

		const result = await loadPondSettingsDraft("pond-1");

		expect(result.success).toBe(false);
		expect(mockPond.findFirst).not.toHaveBeenCalled();
		expect(mockDraft.findUnique).not.toHaveBeenCalled();
	});
});

describe("discardPondSettingsDraft", () => {
	it("deletes only the caller's draft for that pond", async () => {
		const result = await discardPondSettingsDraft("pond-1");

		expect(result).toEqual({ success: true });
		expect(mockDraft.deleteMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1", userId: "user-1" },
		});
	});

	it("denies a caller without write access and deletes nothing", async () => {
		deny();

		const result = await discardPondSettingsDraft("pond-1");

		expect(result.success).toBe(false);
		expect(mockDraft.deleteMany).not.toHaveBeenCalled();
	});

	it("denies a pond outside the caller's scope", async () => {
		mockPond.findFirst.mockResolvedValue(null);

		const result = await discardPondSettingsDraft("pond-other");

		expect(result).toEqual({ success: false, error: "Pond not found" });
		expect(mockDraft.deleteMany).not.toHaveBeenCalled();
	});
});
