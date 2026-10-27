import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
	const client = {
		energyDevice: { findMany: vi.fn() },
		reminderLog: { create: vi.fn() },
		notification: { create: vi.fn() },
		$transaction: vi.fn(async (input: unknown) => {
			if (typeof input === "function") {
				return (input as (tx: unknown) => Promise<unknown>)(client);
			}
			return Promise.all(input as Promise<unknown>[]);
		}),
	};
	return { default: client };
});

import prisma from "@/lib/prisma";
import {
	RECALIBRATION_INTERVAL_MAX_DAYS,
	RECALIBRATION_INTERVAL_MIN_DAYS,
	clampRecalibrationIntervalDays,
	getRecalibrationStatus,
	isValidRecalibrationIntervalDays,
	recalibrationDedupeKey,
	recalibrationDueAt,
} from "../calibration/recalibration";
import { processRecalibrationReminders } from "../calibration/recalibration-reminders";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-27T12:00:00.000Z");
const LAST = new Date("2026-09-01T12:00:00.000Z");

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockReminderLog = vi.mocked(prisma.reminderLog);
const mockNotification = vi.mocked(prisma.notification);
const mockTransaction = vi.mocked(prisma.$transaction);

describe("recalibration date math", () => {
	it("adds the interval to the last calibration", () => {
		const due = recalibrationDueAt(LAST, 30);
		expect(due?.toISOString()).toBe(new Date(LAST.getTime() + 30 * DAY_MS).toISOString());
	});

	it("returns null when the device was never calibrated", () => {
		expect(recalibrationDueAt(null, 30)).toBeNull();
		expect(getRecalibrationStatus(null, 30, NOW)).toEqual({
			dueAt: null,
			isOverdue: false,
			daysOverdue: 0,
		});
	});

	it("clamps an out-of-range stored interval", () => {
		expect(clampRecalibrationIntervalDays(1)).toBe(RECALIBRATION_INTERVAL_MIN_DAYS);
		expect(clampRecalibrationIntervalDays(999)).toBe(RECALIBRATION_INTERVAL_MAX_DAYS);
		expect(clampRecalibrationIntervalDays(null)).toBe(30);
	});

	it("reports overdue whole days", () => {
		const last = new Date(NOW.getTime() - 40 * DAY_MS);
		const status = getRecalibrationStatus(last, 30, NOW);

		expect(status.isOverdue).toBe(true);
		expect(status.daysOverdue).toBe(10);
	});

	it("is not overdue before the due date", () => {
		const last = new Date(NOW.getTime() - 10 * DAY_MS);
		const status = getRecalibrationStatus(last, 30, NOW);

		expect(status.isOverdue).toBe(false);
		expect(status.daysOverdue).toBe(0);
	});

	it("builds a stable per-device, per-due-date key", () => {
		const due = new Date("2026-10-01T00:00:00.000Z");
		expect(recalibrationDedupeKey("dev-1", due)).toBe("recal:dev-1:2026-10-01");
	});
});

describe("isValidRecalibrationIntervalDays", () => {
	it("accepts the inclusive 7–180 day bounds", () => {
		expect(isValidRecalibrationIntervalDays(7)).toBe(true);
		expect(isValidRecalibrationIntervalDays(180)).toBe(true);
	});

	it("rejects decimals and out-of-range values", () => {
		for (const value of [6, 181, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(isValidRecalibrationIntervalDays(value)).toBe(false);
		}
	});
});

describe("processRecalibrationReminders", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findMany.mockResolvedValue([] as never);
		mockReminderLog.create.mockResolvedValue({} as never);
		mockNotification.create.mockResolvedValue({} as never);
	});

	it("does nothing when no device is eligible", async () => {
		const result = await processRecalibrationReminders(NOW);

		expect(result).toEqual({ checked: 0, notified: 0, skipped: 0, failed: 0 });
		expect(mockReminderLog.create).not.toHaveBeenCalled();
	});

	it("creates one in-app notification for an overdue device", async () => {
		mockEnergyDevice.findMany.mockResolvedValue([
			{
				id: "dev-1",
				label: "Feeder A",
				pondId: "pond-1",
				lastCalibratedAt: new Date(NOW.getTime() - 40 * DAY_MS),
				recalibrationIntervalDays: 30,
			},
		] as never);

		const result = await processRecalibrationReminders(NOW);

		expect(result).toEqual({ checked: 1, notified: 1, skipped: 0, failed: 0 });
		expect(mockTransaction).toHaveBeenCalledTimes(1);
		expect(mockReminderLog.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				pondId: "pond-1",
				kind: "recalibration_due",
				channel: "in_app",
			}),
		});
		expect(mockNotification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				pondId: "pond-1",
				tier: "WARNING",
				category: "system",
				linkTo: "/dashboard/settings/hardware",
			}),
		});
		const call = mockReminderLog.create.mock.calls[0]?.[0] as
			| { data?: { dedupeKey?: string } }
			| undefined;
		expect(call?.data?.dedupeKey).toMatch(/^recal:dev-1:\d{4}-\d{2}-\d{2}$/);
	});

	it("skips a duplicate due-date reminder without a second notification", async () => {
		mockEnergyDevice.findMany.mockResolvedValue([
			{
				id: "dev-1",
				label: "Feeder A",
				pondId: "pond-1",
				lastCalibratedAt: new Date(NOW.getTime() - 40 * DAY_MS),
				recalibrationIntervalDays: 30,
			},
		] as never);
		mockReminderLog.create.mockRejectedValue(
			Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
		);

		const result = await processRecalibrationReminders(NOW);

		expect(result).toEqual({ checked: 1, notified: 0, skipped: 1, failed: 0 });
		expect(mockNotification.create).not.toHaveBeenCalled();
	});

	it("does not notify before the interval elapses", async () => {
		mockEnergyDevice.findMany.mockResolvedValue([
			{
				id: "dev-1",
				label: "Feeder A",
				pondId: "pond-1",
				lastCalibratedAt: new Date(NOW.getTime() - 10 * DAY_MS),
				recalibrationIntervalDays: 30,
			},
		] as never);

		const result = await processRecalibrationReminders(NOW);

		expect(result).toEqual({ checked: 1, notified: 0, skipped: 0, failed: 0 });
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("counts an unexpected write failure without aborting the batch", async () => {
		mockEnergyDevice.findMany.mockResolvedValue([
			{
				id: "dev-1",
				label: "Feeder A",
				pondId: "pond-1",
				lastCalibratedAt: new Date(NOW.getTime() - 40 * DAY_MS),
				recalibrationIntervalDays: 30,
			},
			{
				id: "dev-2",
				label: "Feeder B",
				pondId: "pond-2",
				lastCalibratedAt: new Date(NOW.getTime() - 40 * DAY_MS),
				recalibrationIntervalDays: 30,
			},
		] as never);
		mockReminderLog.create
			.mockRejectedValueOnce(new Error("db down"))
			.mockResolvedValue({} as never);

		const result = await processRecalibrationReminders(NOW);

		expect(result).toEqual({ checked: 2, notified: 1, skipped: 0, failed: 1 });
	});
});
