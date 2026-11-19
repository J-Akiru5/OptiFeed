import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The physical button's dose (issue #658).
 *
 * The column was overlaid into the poll response but nothing wrote it, so every
 * unit dispensed the 80 g schema default. These checks pin the three things
 * that make the new control safe:
 *  - the input/server envelope is the firmware's own 1-5,000 g range;
 *  - a write records its audit row and returns the stored value;
 *  - the page can distinguish "confirmed by the device" from "saved but not
 *    reported", rather than presenting a write as applied.
 */

const { db, mocks } = vi.hoisted(() => {
	const db = {
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn(), findFirst: vi.fn() },
		feedEvent: { findFirst: vi.fn() },
		$transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
	};
	return {
		db,
		mocks: {
			requirePermission: vi.fn(),
			revalidatePath: vi.fn(),
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
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateDeviceButtonFeed } from "@/lib/actions/settings";
import { FIRMWARE_FIELDS } from "@/lib/firmware/config";
import { BUTTON_FEED_GRAMS_MAX, BUTTON_FEED_GRAMS_MIN, buttonFeedGramsSchema } from "@/lib/limits";
import {
	BUTTON_FEED_CHANGED_EVENT,
	type ButtonFeedReport,
	buttonFeedConfirmation,
	loadButtonFeedReport,
} from "@/lib/settings/button-feed";

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
const firmwareHeader = readFileSync(join(repoRoot, "firmware/firmware-main/config.h"), "utf8");

function report(overrides: Partial<ButtonFeedReport> = {}): ButtonFeedReport {
	return {
		available: true,
		storedGrams: 120,
		lastPress: null,
		changedAt: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue(undefined);
	db.energyDevice.findFirst.mockResolvedValue({ id: "device-1", buttonFeedGrams: 80 });
	db.energyDevice.update.mockResolvedValue({});
	db.deviceStateEvent.create.mockResolvedValue({});
});

describe("the window mirrors the firmware", () => {
	it("uses the firmware's button_feed_grams envelope", () => {
		const match = firmwareHeader.match(
			/X\(buttonFeedGrams, "button_feed_grams",\s*(-?\d+(?:\.\d+)?)f,\s*(-?\d+(?:\.\d+)?)f/,
		);
		expect(match, "config.h must declare buttonFeedGrams").not.toBeNull();
		expect(Number(match?.[1])).toBe(BUTTON_FEED_GRAMS_MIN);
		expect(Number(match?.[2])).toBe(BUTTON_FEED_GRAMS_MAX);
	});

	it("keeps the server field table in step with the same limits", () => {
		const field = FIRMWARE_FIELDS.find((entry) => entry.id === "button_feed_grams");
		expect(field).toMatchObject({
			min: BUTTON_FEED_GRAMS_MIN,
			max: BUTTON_FEED_GRAMS_MAX,
			defaultValue: 80,
		});
	});

	it("accepts only values inside 1-5,000 g", () => {
		expect(buttonFeedGramsSchema.safeParse(0.99).success).toBe(false);
		expect(buttonFeedGramsSchema.safeParse(1).success).toBe(true);
		expect(buttonFeedGramsSchema.safeParse(80.5).success).toBe(true);
		expect(buttonFeedGramsSchema.safeParse(5000).success).toBe(true);
		expect(buttonFeedGramsSchema.safeParse(5000.01).success).toBe(false);
		expect(buttonFeedGramsSchema.safeParse(Number.NaN).success).toBe(false);
	});
});

describe("what the device reported", () => {
	it("is unconfirmed until a later press reports the stored dose", () => {
		const changedAt = new Date("2026-11-03T10:00:00.000Z");

		expect(
			buttonFeedConfirmation(
				report({
					changedAt,
					lastPress: { grams: 120, receivedAt: new Date("2026-11-03T10:05:00.000Z") },
				}),
			),
		).toBe("confirmed");

		// A press that happened before the change cannot confirm it.
		expect(
			buttonFeedConfirmation(
				report({
					changedAt,
					lastPress: { grams: 80, receivedAt: new Date("2026-11-03T09:55:00.000Z") },
				}),
			),
		).toBe("unconfirmed");

		// A later press that dispensed another dose is not a success either.
		expect(
			buttonFeedConfirmation(
				report({
					changedAt,
					lastPress: { grams: 80, receivedAt: new Date("2026-11-03T10:05:00.000Z") },
				}),
			),
		).toBe("unconfirmed");
	});

	it("names the cases that are not a confirmation", () => {
		expect(buttonFeedConfirmation(report({ changedAt: new Date(), lastPress: null }))).toBe(
			"no_press",
		);
		expect(buttonFeedConfirmation(report({ changedAt: null }))).toBe("no_change");
		expect(buttonFeedConfirmation(report({ available: false }))).toBe("unavailable");
	});
});

describe("loadButtonFeedReport", () => {
	it("reads the newest device press and the last dashboard change", async () => {
		const receivedAt = new Date("2026-11-03T10:05:00.000Z");
		const createdAt = new Date("2026-11-03T10:00:00.000Z");
		db.feedEvent.findFirst.mockResolvedValue({ grams: 120, receivedAt });
		db.deviceStateEvent.findFirst.mockResolvedValue({ createdAt });

		const loaded = await loadButtonFeedReport("device-1", 120);

		expect(loaded).toEqual({
			available: true,
			storedGrams: 120,
			lastPress: { grams: 120, receivedAt },
			changedAt: createdAt,
		});
		expect(db.feedEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					deviceId: "device-1",
					source: "button",
					dataSource: "device",
				}),
			}),
		);
		expect(db.deviceStateEvent.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { deviceId: "device-1", eventType: BUTTON_FEED_CHANGED_EVENT },
			}),
		);
	});

	it("reports unavailable instead of 'no press' when the read fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		db.feedEvent.findFirst.mockRejectedValue(new Error("db down"));
		db.deviceStateEvent.findFirst.mockResolvedValue(null);

		const loaded = await loadButtonFeedReport("device-1", 120);

		expect(loaded).toEqual({
			available: false,
			storedGrams: 120,
			lastPress: null,
			changedAt: null,
		});
		warn.mockRestore();
	});
});

describe("updateDeviceButtonFeed", () => {
	it("requires control_feeder and writes nothing without it", async () => {
		mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));

		const result = await updateDeviceButtonFeed("device-1", 120);

		expect(mocks.requirePermission).toHaveBeenCalledWith("control_feeder");
		expect(result).toEqual({
			success: false,
			error: "You do not have permission to do that.",
			code: "forbidden",
		});
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses an out-of-range dose before reading the device", async () => {
		const result = await updateDeviceButtonFeed("device-1", 5001);

		expect(result.success).toBe(false);
		expect(result.error).toContain("5000");
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a device outside the caller's farm", async () => {
		db.energyDevice.findFirst.mockResolvedValue(null);

		const result = await updateDeviceButtonFeed("device-9", 120);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("stores the dose and records the change in one transaction", async () => {
		const result = await updateDeviceButtonFeed("device-1", 120);

		expect(result).toEqual({ success: true, buttonFeedGrams: 120 });
		expect(db.energyDevice.findFirst).toHaveBeenCalledWith({
			where: { id: "device-1", pond: { ownerId: "farm-1" } },
			select: { id: true, buttonFeedGrams: true },
		});
		expect(db.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: { buttonFeedGrams: 120 },
		});
		expect(db.deviceStateEvent.create).toHaveBeenCalledWith({
			data: {
				deviceId: "device-1",
				eventType: BUTTON_FEED_CHANGED_EVENT,
				source: "user",
				actorId: "farm-1",
				metadata: { previousGrams: 80, buttonFeedGrams: 120 },
			},
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/settings/hardware",
			"page",
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/[locale]/(dashboard)", "layout");
	});

	it("returns a generic error when the transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(new Error("db down"));

		const result = await updateDeviceButtonFeed("device-1", 120);

		expect(result).toEqual({ success: false, error: "Failed to update the button feed amount" });
		consoleError.mockRestore();
	});
});
