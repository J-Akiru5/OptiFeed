import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		platformSetting: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		platformAdmin: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "admin-1", farmId: "superadmin" })),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () => new Headers({ "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-sticker" }),
	),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	clearStickerRatingDefault,
	setStickerRatingDefault,
} from "@/lib/actions/platform/settings";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { STICKER_RATING_KEY } from "@/lib/constants/sticker-rating";

const mockGate = vi.mocked(requirePlatformAdmin);

const REASON = "Measured the feeder with a clamp meter";

const RATING = {
	voltageV: 230,
	frequencyHz: 60 as const,
	currentA: 1.1,
	powerVA: 253,
	measured: true,
	measuredAt: "2026-10-27",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	db.platformAdmin.findUnique.mockResolvedValue(null);
	tx.platformSetting.findUnique.mockResolvedValue(null);
	tx.platformSetting.upsert.mockResolvedValue({});
	tx.platformSetting.delete.mockResolvedValue({});
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("setStickerRatingDefault", () => {
	it("allows a platform admin, saves the key and writes one audit row", async () => {
		const result = await setStickerRatingDefault(RATING, REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith({
			where: { key: STICKER_RATING_KEY },
			create: { key: STICKER_RATING_KEY, value: RATING, updatedById: "admin-1" },
			update: { value: RATING, updatedById: "admin-1" },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					actorUserId: "admin-1",
					action: "platform.settings.sticker_rating",
					targetType: "platform_setting",
					targetId: STICKER_RATING_KEY,
					reason: REASON,
					before: { rating: null },
					after: { rating: RATING },
				}),
			}),
		);
	});

	it("records the previous rating as the old value", async () => {
		const previous = {
			voltageV: 220,
			frequencyHz: 60,
			currentA: 1.2,
			powerVA: 264,
			measured: false,
			measuredAt: null,
		};
		tx.platformSetting.findUnique.mockResolvedValue({ value: previous });

		await setStickerRatingDefault(RATING, REASON);

		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ before: { rating: previous } }),
			}),
		);
	});

	it("computes and stores the VA when the caller leaves it out", async () => {
		const withoutPower = {
			voltageV: RATING.voltageV,
			frequencyHz: RATING.frequencyHz,
			currentA: RATING.currentA,
			measured: false,
			measuredAt: null,
		};

		await setStickerRatingDefault(withoutPower, REASON);

		expect(tx.platformSetting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({
					value: expect.objectContaining({ powerVA: 253 }),
				}),
			}),
		);
	});

	it("denies a tenant admin (no platform grant)", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setStickerRatingDefault(RATING, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setStickerRatingDefault(RATING, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it.each([
		["voltage below 100", { ...RATING, voltageV: 99 }],
		["voltage above 260", { ...RATING, voltageV: 261 }],
		["current below 0.1", { ...RATING, currentA: 0 }],
		["current above 20", { ...RATING, currentA: 20.1 }],
		["power above 5000", { ...RATING, powerVA: 5001 }],
		["a non-50/60 frequency", { ...RATING, frequencyHz: 55 as unknown as 50 }],
	])("rejects %s", async (_label, values) => {
		const result = await setStickerRatingDefault(values, REASON);

		expect(result).toEqual({ error: "The rating values are outside the allowed range." });
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("requires a measurement date for a measured rating", async () => {
		const result = await setStickerRatingDefault({ ...RATING, measuredAt: null }, REASON);

		expect(result).toEqual({
			error: "Enter the measurement date when the rating was measured.",
		});
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("rejects a reason shorter than 10 characters", async () => {
		const result = await setStickerRatingDefault(RATING, "too short");

		expect(result).toEqual({
			error: "A reason of at least 10 characters is required.",
		});
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});
});

describe("clearStickerRatingDefault", () => {
	it("allows a platform admin, deletes the key and audits the old value", async () => {
		const previous = {
			voltageV: 230,
			frequencyHz: 60,
			currentA: 1.1,
			powerVA: 253,
			measured: true,
			measuredAt: "2026-10-27",
		};
		tx.platformSetting.findUnique.mockResolvedValue({ value: previous });

		const result = await clearStickerRatingDefault(REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.delete).toHaveBeenCalledWith({
			where: { key: STICKER_RATING_KEY },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "platform.settings.sticker_rating_clear",
					targetId: STICKER_RATING_KEY,
					before: { rating: previous },
					after: { rating: null },
				}),
			}),
		);
	});

	it("is a no-op when no default is saved", async () => {
		const result = await clearStickerRatingDefault(REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.delete).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("denies a tenant admin", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(clearStickerRatingDefault(REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("requires a reason", async () => {
		const result = await clearStickerRatingDefault("no");

		expect(result).toEqual({
			error: "A reason of at least 10 characters is required.",
		});
		expect(db.$transaction).not.toHaveBeenCalled();
	});
});
