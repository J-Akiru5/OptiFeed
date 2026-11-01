import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for `lib/actions/settings.ts`.
 *
 * Every write path is exercised twice: once with a writable pond owner (allow)
 * and once with `requireWriteAccess()` denying (VIEWER/session), asserting that
 * nothing is read or written on the denial. The success cases assert what the
 * farmer would observe — the persisted values, the merged profile bridge, the
 * device event written alongside a hardware change, and the exact failure a
 * range violation returns.
 */

const { db } = vi.hoisted(() => {
	const db = {
		pond: { findFirst: vi.fn(), update: vi.fn() },
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		biomassLog: { findFirst: vi.fn() },
		cropCycle: { updateMany: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
		$transaction: vi.fn(),
	};
	return { db };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => ({
	requireWriteAccess: vi.fn(),
	getCurrentPondOwnerId: vi.fn(),
}));
vi.mock("@/lib/feed-grams", () => ({ syncDeviceGramsForPond: vi.fn() }));
vi.mock("@/lib/actions/schedule", () => ({ updateScheduleCommand: vi.fn() }));
vi.mock("@/lib/settings/feeding-caps", () => ({
	getFeedingLimits: vi.fn(async () => ({ maxDispenseMs: 300_000, dailyCapFactor: 1 })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateScheduleCommand } from "@/lib/actions/schedule";
import {
	updateDeviceDailyCap,
	updateNotificationPrefs,
	updatePondSettings,
} from "@/lib/actions/settings";
import {
	type ActionDenialReason,
	ActionDeniedError,
	denialMessage,
} from "@/lib/auth/action-denial";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { syncDeviceGramsForPond } from "@/lib/feed-grams";
import { revalidatePath } from "next/cache";

const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockOwnerId = vi.mocked(getCurrentPondOwnerId);
const mockSchedule = vi.mocked(updateScheduleCommand);
const mockSyncGrams = vi.mocked(syncDeviceGramsForPond);
const mockRevalidate = vi.mocked(revalidatePath);

/** The stored shape after zod applies the schema defaults. */
const PARSED_PREFS = {
	missedFeeding: false,
	deviceOffline: true,
	hopperLow: false,
	harvestReminders: true,
	samplingReminders: true,
	emailReminders: true,
};

let consoleError: ReturnType<typeof vi.spyOn>;

const POND = {
	id: "pond-1",
	notificationPrefs: {} as unknown,
	scheduleStart: new Date("1970-01-01T06:00:00.000Z"),
	scheduleEnd: new Date("1970-01-01T18:30:00.000Z"),
};

function allowWrites() {
	mockRequireWriteAccess.mockResolvedValue(undefined);
	mockOwnerId.mockResolvedValue("farm-a");
}

function denyWrites() {
	mockRequireWriteAccess.mockRejectedValue(new Error("Write access required (ADMIN or OPERATOR)"));
}

/** Refuse with the typed guard error the real requireWriteAccess now throws. */
function denyWritesWith(reason: ActionDenialReason) {
	mockRequireWriteAccess.mockRejectedValue(new ActionDeniedError(reason));
}

beforeEach(() => {
	vi.clearAllMocks();
	consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	allowWrites();
	db.pond.findFirst.mockResolvedValue({ ...POND });
	db.pond.update.mockResolvedValue({});
	db.energyDevice.findFirst.mockResolvedValue(null);
	db.energyDevice.update.mockResolvedValue({});
	db.biomassLog.findFirst.mockResolvedValue(null);
	db.deviceStateEvent.create.mockResolvedValue({});
	db.$transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
		Promise.all(operations),
	);
	mockSchedule.mockResolvedValue({ success: true, commandId: "cmd-1" });
	mockSyncGrams.mockResolvedValue(120);
});

afterEach(() => {
	consoleError.mockRestore();
});

describe("updateNotificationPrefs", () => {
	const prefs = { missedFeeding: false, deviceOffline: true, hopperLow: false };

	it("denies a viewer before reading the pond and writes nothing", async () => {
		denyWrites();

		const result = await updateNotificationPrefs("pond-1", prefs);

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to make this change.",
			code: "wrong_role",
		});
		expect(db.pond.findFirst).not.toHaveBeenCalled();
		expect(db.pond.update).not.toHaveBeenCalled();
	});

	it.each([
		["not_authenticated"],
		["password_change_required"],
		["wrong_role"],
		["org_suspended"],
		["view_as_read_only"],
		["step_up_required"],
	] as const)("returns the %s reason instead of the generic failure", async (reason) => {
		denyWritesWith(reason);

		const result = await updateNotificationPrefs("pond-1", prefs);

		expect(result).toEqual({
			success: false,
			error: denialMessage(reason),
			code: reason,
		});
		expect(db.pond.findFirst).not.toHaveBeenCalled();
	});

	it("rethrows a guard redirect instead of flattening it", async () => {
		const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
			digest: "NEXT_REDIRECT;replace;/dashboard;307;",
		});
		mockRequireWriteAccess.mockRejectedValueOnce(redirect);

		await expect(updateNotificationPrefs("pond-1", prefs)).rejects.toBe(redirect);
	});

	it("returns the validation error for a non-boolean preference", async () => {
		const result = await updateNotificationPrefs("pond-1", {
			...prefs,
			hopperLow: "yes",
		} as never);

		expect(result).toEqual({
			success: false,
			error: expect.stringContaining("hopperLow"),
		});
		expect(db.pond.findFirst).not.toHaveBeenCalled();
	});

	it("answers not found for a pond outside the caller's ownership", async () => {
		db.pond.findFirst.mockResolvedValue(null);

		const result = await updateNotificationPrefs("pond-1", prefs);

		expect(result).toEqual({ success: false, error: "Pond not found" });
		expect(db.pond.update).not.toHaveBeenCalled();
	});

	it("saves the preferences and preserves the pond-profile bridge", async () => {
		db.pond.findFirst.mockResolvedValue({
			...POND,
			notificationPrefs: {
				missedFeeding: true,
				profile: { areaM2: 800, averageDepthM: 1.5, feedPricePerKg: 42 },
				growthTarget: { targetWeightG: 250, cycleId: "cycle-1", setAt: "2026-10-01" },
			},
		});

		const result = await updateNotificationPrefs("pond-1", prefs);

		expect(result).toEqual({ success: true });
		expect(db.pond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: {
				notificationPrefs: {
					...PARSED_PREFS,
					profile: { areaM2: 800, averageDepthM: 1.5, feedPricePerKg: 42 },
				},
			},
		});
		expect(mockRevalidate).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/settings/profile",
			"page",
		);
	});

	it.each([
		["null", null],
		["an array", [1, 2, 3]],
		["a string", "corrupt"],
	])("treats %s stored prefs as empty without inventing a profile", async (_label, stored) => {
		db.pond.findFirst.mockResolvedValue({ ...POND, notificationPrefs: stored });

		await expect(updateNotificationPrefs("pond-1", prefs)).resolves.toEqual({ success: true });
		expect(db.pond.update.mock.calls[0]?.[0].data.notificationPrefs).toEqual(PARSED_PREFS);
	});

	it("returns a generic error when the write fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.pond.update.mockRejectedValue(new Error("db down"));

		const result = await updateNotificationPrefs("pond-1", prefs);

		expect(result).toEqual({
			success: false,
			error: "Failed to update notification preferences",
		});
		consoleError.mockRestore();
	});
});

describe("updatePondSettings", () => {
	it("denies a viewer before reading the pond and writes nothing", async () => {
		denyWrites();

		const result = await updatePondSettings("pond-1", 3, 2);

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to make this change.",
			code: "wrong_role",
			fieldErrors: [],
			conflicts: [],
		});
		expect(db.pond.findFirst).not.toHaveBeenCalled();
		expect(db.pond.update).not.toHaveBeenCalled();
		expect(mockSyncGrams).not.toHaveBeenCalled();
	});

	it.each([
		["not_authenticated"],
		["password_change_required"],
		["wrong_role"],
		["org_suspended"],
		["view_as_read_only"],
		["step_up_required"],
	] as const)("returns the %s reason with no field errors", async (reason) => {
		denyWritesWith(reason);

		const result = await updatePondSettings("pond-1", 3, 2);

		expect(result).toEqual({
			success: false,
			error: denialMessage(reason),
			code: reason,
			fieldErrors: [],
			conflicts: [],
		});
		expect(db.pond.findFirst).not.toHaveBeenCalled();
	});

	it("rethrows a guard redirect instead of turning it into a save failure", async () => {
		const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
			digest: "NEXT_REDIRECT;replace;/dashboard;307;",
		});
		mockRequireWriteAccess.mockRejectedValueOnce(redirect);

		await expect(updatePondSettings("pond-1", 3, 2)).rejects.toBe(redirect);
	});

	it.each([
		["a feeding rate below the minimum", [0, 2], /Feeding rate/],
		["a feeding rate above the maximum", [11, 2], /Feeding rate/],
		["a fractional feeds-per-day", [3, 2.5], /whole number/],
		["a population below one", [3, 2, 14, 0], /Population/],
		["a population above the ceiling", [3, 2, 14, 1_000_001], /Population/],
	])("rejects %s without touching the database", async (_label, args, message) => {
		const result = await updatePondSettings("pond-1", ...(args as [number, number]));

		expect(result).toMatchObject({ success: false, error: expect.stringMatching(message) });
		expect(db.pond.findFirst).not.toHaveBeenCalled();
		expect(db.pond.update).not.toHaveBeenCalled();
	});

	it("rejects an invalid profile before the pond lookup", async () => {
		const result = await updatePondSettings("pond-1", 3, 2, undefined, undefined, {
			areaM2: -5,
		});

		expect(result).toMatchObject({ success: false, error: expect.stringContaining("areaM2") });
		expect(db.pond.findFirst).not.toHaveBeenCalled();
	});

	it("answers not found for a pond outside the caller's ownership", async () => {
		db.pond.findFirst.mockResolvedValue(null);

		const result = await updatePondSettings("pond-1", 3, 2);

		expect(result).toMatchObject({ success: false, error: "Pond not found" });
		expect(db.pond.update).not.toHaveBeenCalled();
	});

	it("saves the core settings without inventing optional fields", async () => {
		const result = await updatePondSettings("pond-1", 4.5, 3);

		expect(result).toEqual({ success: true });
		expect(db.pond.update).toHaveBeenCalledWith({
			where: { id: "pond-1" },
			data: { feedingRatePct: 4.5, feedsPerDay: 3 },
		});
		expect(mockSyncGrams).toHaveBeenCalledWith("pond-1", {
			feedingRatePct: 4.5,
			feedsPerDay: 3,
			population: undefined,
		});
		expect(mockRevalidate).toHaveBeenCalledWith("/[locale]/(dashboard)", "layout");
	});

	it("keeps a positive sample interval and an explicit population", async () => {
		await updatePondSettings("pond-1", 3, 2, 21, 1500);

		expect(db.pond.update.mock.calls[0]?.[0].data).toMatchObject({
			sampleIntervalDays: 21,
			population: 1500,
		});
	});

	it.each([0, -7])("drops a non-positive sample interval (%s)", async (interval) => {
		await updatePondSettings("pond-1", 3, 2, interval);

		expect(db.pond.update.mock.calls[0]?.[0].data).not.toHaveProperty("sampleIntervalDays");
	});

	it("merges the profile into the existing bridge without dropping notifications", async () => {
		db.pond.findFirst.mockResolvedValue({
			...POND,
			notificationPrefs: { missedFeeding: false, profile: { areaM2: 500, feedPricePerKg: 30 } },
		});

		await updatePondSettings("pond-1", 3, 2, undefined, undefined, {
			averageDepthM: 1.8,
		});

		expect(db.pond.update.mock.calls[0]?.[0].data.notificationPrefs).toEqual({
			missedFeeding: false,
			profile: { areaM2: 500, feedPricePerKg: 30, averageDepthM: 1.8 },
		});
	});

	it("pushes the schedule to the device and records one settings_changed event", async () => {
		db.energyDevice.findFirst.mockResolvedValue({ id: "device-1" });

		const result = await updatePondSettings("pond-1", 5, 4, 14, 900, { areaM2: 1200 });

		expect(result).toEqual({ success: true });
		expect(mockSchedule).toHaveBeenCalledWith("pond-1", "device-1", {
			scheduleStart: "06:00",
			scheduleEnd: "18:30",
			feedsPerDay: 4,
			feedingRatePct: 5,
			// The pond row still holds the old count, so the command is told which
			// count the dose is derived from (#430).
			population: 900,
		});
		expect(db.deviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "settings_changed",
				source: "user",
				actorId: "farm-a",
				metadata: {
					feedingRatePct: 5,
					feedsPerDay: 4,
					sampleIntervalDays: 14,
					population: 900,
					profile: { areaM2: 1200 },
				},
			},
		});
		expect(db.pond.update).toHaveBeenCalled();
		expect(mockSyncGrams).toHaveBeenCalledWith("pond-1", {
			feedingRatePct: 5,
			feedsPerDay: 4,
			population: 900,
		});
		expect(mockRevalidate).toHaveBeenCalledWith("/[locale]/(dashboard)", "layout");
	});

	it("returns the command refusal and leaves the pond and device event unwritten", async () => {
		db.energyDevice.findFirst.mockResolvedValue({ id: "device-1" });
		mockSchedule.mockResolvedValue({
			success: false,
			error: "Schedule exceeds the g/day limit",
		});

		const result = await updatePondSettings("pond-1", 5, 24);

		expect(result).toMatchObject({ success: false, error: "Schedule exceeds the g/day limit" });
		expect(db.deviceStateEvent.create).not.toHaveBeenCalled();
		expect(db.pond.update).not.toHaveBeenCalled();
		// The dose is derived from the typed values before the command validates
		// it (#371), so the sync happens even when the command then refuses.
		expect(mockSyncGrams).toHaveBeenCalled();
	});

	it("returns a generic error when persistence fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.pond.update.mockRejectedValue(new Error("db down"));

		const result = await updatePondSettings("pond-1", 3, 2);

		expect(result).toMatchObject({
			success: false,
			error: "Failed to update pond settings",
		});
		consoleError.mockRestore();
	});
});

describe("updateDeviceDailyCap", () => {
	it("denies a viewer before reading the device and writes nothing", async () => {
		denyWrites();

		const result = await updateDeviceDailyCap("device-1", 2500);

		expect(result).toEqual({
			success: false,
			error: "You do not have permission to make this change.",
			code: "wrong_role",
		});
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it.each([
		["not_authenticated"],
		["password_change_required"],
		["wrong_role"],
		["org_suspended"],
		["view_as_read_only"],
		["step_up_required"],
	] as const)("returns the %s reason instead of the generic failure", async (reason) => {
		denyWritesWith(reason);

		const result = await updateDeviceDailyCap("device-1", 2500);

		expect(result).toEqual({
			success: false,
			error: denialMessage(reason),
			code: reason,
		});
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
	});

	it("rethrows a guard redirect instead of reporting a failed save", async () => {
		const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
			digest: "NEXT_REDIRECT;replace;/dashboard;307;",
		});
		mockRequireWriteAccess.mockRejectedValueOnce(redirect);

		await expect(updateDeviceDailyCap("device-1", 2500)).rejects.toBe(redirect);
	});

	it.each([
		["below the floor", 499, /at least 500/],
		["above the hard guard", 5001, /cannot exceed 5000/],
		["fractional", 2500.5, /whole number/],
		["not a number", Number.NaN, /must be a number/],
	])("rejects a cap %s without reading the device", async (_label, value, message) => {
		const result = await updateDeviceDailyCap("device-1", value);

		expect(result).toEqual({ success: false, error: expect.stringMatching(message) });
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
	});

	it("answers not found for a device on another tenant's pond", async () => {
		db.energyDevice.findFirst.mockResolvedValue(null);

		const result = await updateDeviceDailyCap("device-b-1", 2500);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(db.energyDevice.update).not.toHaveBeenCalled();
	});

	it("stores the new ceiling and audits the previous value", async () => {
		db.energyDevice.findFirst.mockResolvedValue({ id: "device-1", dailyCapG: 1800 });

		const result = await updateDeviceDailyCap("device-1", 2500);

		expect(result).toEqual({ success: true, dailyCapG: 2500 });
		expect(db.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { dailyCapG: 2500 },
		});
		expect(db.deviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: "daily_cap_changed",
				source: "user",
				actorId: "farm-a",
				metadata: { previousCapG: 1800, dailyCapG: 2500 },
			},
		});
		expect(db.$transaction).toHaveBeenCalledTimes(1);
		expect(db.$transaction.mock.calls[0]?.[0]).toHaveLength(2);
		expect(mockRevalidate).toHaveBeenCalledWith("/[locale]/(dashboard)", "layout");
	});

	it("scopes the device lookup to the caller's own ponds", async () => {
		db.energyDevice.findFirst.mockResolvedValue({ id: "device-1", dailyCapG: 2000 });

		await updateDeviceDailyCap("device-1", 2000);

		expect(db.energyDevice.findFirst).toHaveBeenCalledWith({
			where: { id: "device-1", pond: { ownerId: "farm-a" } },
			select: { id: true, dailyCapG: true },
		});
	});

	it("returns a generic error when the transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.energyDevice.findFirst.mockResolvedValue({ id: "device-1", dailyCapG: 2000 });
		db.$transaction.mockRejectedValue(new Error("db down"));

		const result = await updateDeviceDailyCap("device-1", 2500);

		expect(result).toEqual({
			success: false,
			error: "Failed to update the daily feed ceiling",
		});
		consoleError.mockRestore();
	});
});
