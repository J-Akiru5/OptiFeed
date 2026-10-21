import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentSchedule } from "../schedule/resolve-current";

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findUnique: vi.fn() },
		scheduleCommand: { findFirst: vi.fn() },
	},
}));

import prisma from "@/lib/prisma";

const mockPond = vi.mocked(prisma.pond);
const mockCommand = vi.mocked(prisma.scheduleCommand);

describe("resolveCurrentSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when pond does not exist", async () => {
		mockPond.findUnique.mockResolvedValue(null);
		const result = await resolveCurrentSchedule("pond-1", "device-1");
		expect(result).toBeNull();
	});

	it("returns pond defaults when no device and no commands", async () => {
		mockPond.findUnique.mockResolvedValue({
			id: "pond-1",
			name: "Test Pond",
			createdAt: new Date(),
			ownerId: "owner-1",
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 3,
			feedingRatePct: 3.5,
			sampleIntervalDays: 14,
			notificationPrefs: { missedFeeding: true, deviceOffline: true, hopperLow: true },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any);

		const result = await resolveCurrentSchedule("pond-1", null);
		expect(result).toEqual({
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 3,
			feedingRatePct: 3.5,
		});
	});

	it("returns pending command when device has pending command", async () => {
		mockPond.findUnique.mockResolvedValue({
			id: "pond-1",
			name: "Test Pond",
			createdAt: new Date(),
			ownerId: "owner-1",
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 2,
			feedingRatePct: 3.0,
			sampleIntervalDays: 14,
			notificationPrefs: { missedFeeding: true, deviceOffline: true, hopperLow: true },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any);

		// First call for latestApplied, second for pending
		mockCommand.findFirst
			.mockResolvedValueOnce(null) // no applied command
			.mockResolvedValueOnce({
				id: "cmd-1",
				deviceId: "device-1",
				status: "pending",
				createdAt: new Date(),
				updatedAt: new Date(),
				scheduleStart: new Date("2026-01-01T07:00:00Z"),
				scheduleEnd: new Date("2026-01-01T19:00:00Z"),
				feedsPerDay: 4,
				feedingRatePct: 4.0,
				sentAt: null,
				appliedAt: null,
				error: null,
				deviceTime: null,
				firmwareVersion: null,
				feedVolumeG: null,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any);

		const result = await resolveCurrentSchedule("pond-1", "device-1");
		expect(result).toEqual({
			scheduleStart: new Date("2026-01-01T07:00:00Z"),
			scheduleEnd: new Date("2026-01-01T19:00:00Z"),
			feedsPerDay: 4,
			feedingRatePct: 4.0,
		});
	});

	it("returns applied command when no pending but applied exists", async () => {
		mockPond.findUnique.mockResolvedValue({
			id: "pond-1",
			name: "Test Pond",
			createdAt: new Date(),
			ownerId: "owner-1",
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 2,
			feedingRatePct: 3.0,
			sampleIntervalDays: 14,
			notificationPrefs: { missedFeeding: true, deviceOffline: true, hopperLow: true },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any);

		mockCommand.findFirst
			.mockResolvedValueOnce({
				id: "cmd-1",
				deviceId: "device-1",
				status: "applied",
				createdAt: new Date(),
				updatedAt: new Date(),
				scheduleStart: new Date("2026-01-01T08:00:00Z"),
				scheduleEnd: new Date("2026-01-01T20:00:00Z"),
				feedsPerDay: 5,
				feedingRatePct: 5.0,
				sentAt: new Date(),
				appliedAt: new Date(),
				error: null,
				deviceTime: null,
				firmwareVersion: null,
				feedVolumeG: null,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)
			.mockResolvedValueOnce(null); // no pending

		const result = await resolveCurrentSchedule("pond-1", "device-1");
		expect(result).toEqual({
			scheduleStart: new Date("2026-01-01T08:00:00Z"),
			scheduleEnd: new Date("2026-01-01T20:00:00Z"),
			feedsPerDay: 5,
			feedingRatePct: 5.0,
		});
	});

	it("prefers pending over applied command", async () => {
		mockPond.findUnique.mockResolvedValue({
			id: "pond-1",
			name: "Test Pond",
			createdAt: new Date(),
			ownerId: "owner-1",
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 2,
			feedingRatePct: 3.0,
			sampleIntervalDays: 14,
			notificationPrefs: { missedFeeding: true, deviceOffline: true, hopperLow: true },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any);

		mockCommand.findFirst
			.mockResolvedValueOnce({
				id: "cmd-1",
				deviceId: "device-1",
				status: "applied",
				createdAt: new Date(),
				updatedAt: new Date(),
				scheduleStart: new Date("2026-01-01T08:00:00Z"),
				scheduleEnd: new Date("2026-01-01T20:00:00Z"),
				feedsPerDay: 5,
				feedingRatePct: 5.0,
				sentAt: new Date(),
				appliedAt: new Date(),
				error: null,
				deviceTime: null,
				firmwareVersion: null,
				feedVolumeG: null,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any)
			.mockResolvedValueOnce({
				id: "cmd-2",
				deviceId: "device-1",
				status: "pending",
				createdAt: new Date(),
				updatedAt: new Date(),
				scheduleStart: new Date("2026-01-01T09:00:00Z"),
				scheduleEnd: new Date("2026-01-01T21:00:00Z"),
				feedsPerDay: 6,
				feedingRatePct: 6.0,
				sentAt: null,
				appliedAt: null,
				error: null,
				deviceTime: null,
				firmwareVersion: null,
				feedVolumeG: null,
				// biome-ignore lint/suspicious/noExplicitAny: test mock
			} as any);

		const result = await resolveCurrentSchedule("pond-1", "device-1");
		expect(result?.feedsPerDay).toBe(6);
		expect(result?.feedingRatePct).toBe(6.0);
	});

	it("queries with correct deviceId filter", async () => {
		mockPond.findUnique.mockResolvedValue({
			id: "pond-1",
			name: "Test Pond",
			createdAt: new Date(),
			ownerId: "owner-1",
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 2,
			feedingRatePct: 3.0,
			sampleIntervalDays: 14,
			notificationPrefs: { missedFeeding: true, deviceOffline: true, hopperLow: true },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
		} as any);
		mockCommand.findFirst.mockResolvedValue(null);

		await resolveCurrentSchedule("pond-1", "device-xyz");

		expect(mockCommand.findFirst).toHaveBeenCalledWith({
			where: { deviceId: "device-xyz", status: "applied" },
			orderBy: { appliedAt: "desc" },
			select: {
				scheduleStart: true,
				scheduleEnd: true,
				feedsPerDay: true,
				feedingRatePct: true,
			},
		});
	});
});
