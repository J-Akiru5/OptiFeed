import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mocks } = vi.hoisted(() => {
	const db = {
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		pond: { findFirst: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		$transaction: vi.fn(),
	};
	return {
		db,
		mocks: {
			requirePermission: vi.fn(),
		},
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
}));
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/actions/schedule", () => ({ updateScheduleCommand: vi.fn() }));
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateDeviceDailyCap, updateNotificationPrefs } from "@/lib/actions/settings";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue(undefined);
	db.energyDevice.findFirst.mockResolvedValue({ id: "device-1", dailyCapG: 4000 });
	db.pond.findFirst.mockResolvedValue({ id: "pond-1", notificationPrefs: null });
	db.$transaction.mockResolvedValue([]);
});

describe("settings actions require membership permissions", () => {
	it("daily cap requires control_feeder and writes nothing without it", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("Forbidden"));

		const result = await updateDeviceDailyCap("device-1", 4500);

		expect(mocks.requirePermission).toHaveBeenCalledWith("control_feeder");
		expect(result).toEqual({
			success: false,
			error: "You do not have permission to do that.",
			code: "forbidden",
		});
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("daily cap saves and confirms the stored value", async () => {
		const result = await updateDeviceDailyCap("device-1", 4500);

		expect(result).toEqual({ success: true, dailyCapG: 4500 });
		expect(db.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { dailyCapG: 4500 },
		});
	});

	it("personal notification prefs use the active-membership gate", async () => {
		const result = await updateNotificationPrefs("pond-1", {
			missedFeeding: true,
			deviceOffline: true,
			hopperLow: false,
		});

		expect(mocks.requirePermission).toHaveBeenCalledWith("view_dashboard");
		expect(result).toEqual({ success: true });
	});
});
