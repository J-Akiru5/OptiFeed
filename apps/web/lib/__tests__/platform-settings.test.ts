import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		platformAdmin: { findUnique: vi.fn() },
		platformSetting: { findUnique: vi.fn() },
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
		async () => new Headers({ "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-settings" }),
	),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setListPageSize } from "@/lib/actions/platform/settings";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	LIST_PAGE_SIZE_DEFAULT,
	LIST_PAGE_SIZE_KEY,
	normalizeListPageSize,
} from "@/lib/settings/platform";

const mockGate = vi.mocked(requirePlatformAdmin);

const VALID_REASON = "Keep long audit logs readable";

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	db.platformAdmin.findUnique.mockResolvedValue(null);
	db.platformSetting.findUnique.mockResolvedValue({ value: 20 });
	tx.platformSetting.findUnique.mockResolvedValue({ value: 20 });
	tx.platformSetting.upsert.mockResolvedValue({});
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("normalizeListPageSize", () => {
	it("accepts whole numbers inside 5–100", () => {
		expect(normalizeListPageSize(5)).toBe(5);
		expect(normalizeListPageSize(37)).toBe(37);
		expect(normalizeListPageSize(100)).toBe(100);
		expect(normalizeListPageSize({ value: 25 })).toBe(25);
	});

	it("falls back to 20 for missing, out-of-range or non-integer values", () => {
		expect(normalizeListPageSize(undefined)).toBe(LIST_PAGE_SIZE_DEFAULT);
		expect(normalizeListPageSize(null)).toBe(LIST_PAGE_SIZE_DEFAULT);
		expect(normalizeListPageSize(4)).toBe(LIST_PAGE_SIZE_DEFAULT);
		expect(normalizeListPageSize(101)).toBe(LIST_PAGE_SIZE_DEFAULT);
		expect(normalizeListPageSize(20.5)).toBe(LIST_PAGE_SIZE_DEFAULT);
		expect(normalizeListPageSize("nope")).toBe(LIST_PAGE_SIZE_DEFAULT);
	});
});

describe("setListPageSize", () => {
	it("allows a platform admin, upserts the setting and writes one audit row", async () => {
		const result = await setListPageSize(40, VALID_REASON);

		expect(result).toEqual({ success: true, value: 40 });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith({
			where: { key: LIST_PAGE_SIZE_KEY },
			create: { key: LIST_PAGE_SIZE_KEY, value: 40, updatedById: "admin-1" },
			update: { value: 40, updatedById: "admin-1" },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					actorUserId: "admin-1",
					action: "platform.settings.list_page_size",
					targetType: "platform_setting",
					targetId: LIST_PAGE_SIZE_KEY,
					reason: VALID_REASON,
					before: { pageSize: 20 },
					after: { pageSize: 40 },
				}),
			}),
		);
	});

	it("records the default as the old value when the row does not exist yet", async () => {
		tx.platformSetting.findUnique.mockResolvedValue(null);

		await setListPageSize(25, VALID_REASON);

		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ before: { pageSize: LIST_PAGE_SIZE_DEFAULT } }),
			}),
		);
	});

	it("denies a tenant admin (no platform grant)", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setListPageSize(40, VALID_REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setListPageSize(20, VALID_REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it.each([4, 101, 20.5, Number.NaN])("rejects the invalid page size %s", async (value) => {
		const result = await setListPageSize(value, VALID_REASON);

		expect(result).toEqual({
			error: "Choose a whole number from 5 to 100.",
		});
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("rejects a reason shorter than 10 characters", async () => {
		const result = await setListPageSize(20, "too short");

		expect(result).toEqual({
			error: "A reason of at least 10 characters is required.",
		});
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});
});
