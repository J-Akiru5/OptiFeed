import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		feedEvent: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		pondSettingsDraft: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		deviceStateEvent: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		notification: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		feedRequest: {
			findMany: vi.fn(),
		},
		waterTempLog: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		feedLevelLog: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		calibrationRun: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		assistantAction: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		issueReport: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		reminderLog: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
		platformAuditLog: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
		},
	},
}));

import prisma from "@/lib/prisma";
import {
	ASSISTANT_ACTION_RETENTION_DAYS,
	CALIBRATION_RUN_RETENTION_DAYS,
	DEVICE_STATE_RETENTION_DAYS,
	FEED_LEVEL_RETENTION_DAYS,
	HEARTBEAT_RETENTION_DAYS,
	ISSUE_REPORT_RETENTION_DAYS,
	NOTIFICATION_RETENTION_DAYS,
	PLATFORM_AUDIT_LOG_RETENTION_DAYS,
	POND_SETTINGS_DRAFT_RETENTION_DAYS,
	REMINDER_LOG_RETENTION_DAYS,
	WATER_TEMP_RETENTION_DAYS,
	deleteExpiredPondSettingsDrafts,
	deleteOldAssistantActions,
	deleteOldCalibrationRuns,
	deleteOldDeviceStateEvents,
	deleteOldFeedLevelLogs,
	deleteOldHeartbeatEvents,
	deleteOldIssueReports,
	deleteOldNotifications,
	deleteOldPlatformAuditLogs,
	deleteOldReminderLogs,
	deleteOldWaterTempLogs,
} from "@/lib/retention";

const mockFeedEvent = vi.mocked(prisma.feedEvent);
const mockDraft = vi.mocked(prisma.pondSettingsDraft);
const mockDeviceStateEvent = vi.mocked(prisma.deviceStateEvent);
const mockNotification = vi.mocked(prisma.notification);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockWaterTempLog = vi.mocked(prisma.waterTempLog);
const mockFeedLevelLog = vi.mocked(prisma.feedLevelLog);
const mockCalibrationRun = vi.mocked(prisma.calibrationRun);
const mockAssistantAction = vi.mocked(prisma.assistantAction);
const mockIssueReport = vi.mocked(prisma.issueReport);
const mockReminderLog = vi.mocked(prisma.reminderLog);
const mockPlatformAuditLog = vi.mocked(prisma.platformAuditLog);

type AgeWhere = {
	createdAt?: { lt: Date };
	recordedAt?: { lt: Date };
	sentAt?: { lt: Date };
	OR?: unknown[];
};

function ageWhere(call: unknown): AgeWhere {
	return (call as { where: AgeWhere }).where;
}

function expectCutoff(cutoff: Date | undefined, days: number): void {
	expect(cutoff).toBeInstanceOf(Date);
	const expected = Date.now() - days * 24 * 60 * 60 * 1000;
	expect(Math.abs((cutoff as Date).getTime() - expected)).toBeLessThan(5000);
}

describe("retention windows (#726)", () => {
	it("pins the documented day counts", () => {
		expect(WATER_TEMP_RETENTION_DAYS).toBe(365);
		expect(FEED_LEVEL_RETENTION_DAYS).toBe(365);
		expect(NOTIFICATION_RETENTION_DAYS).toBe(180);
		expect(CALIBRATION_RUN_RETENTION_DAYS).toBe(730);
		expect(ASSISTANT_ACTION_RETENTION_DAYS).toBe(180);
		expect(ISSUE_REPORT_RETENTION_DAYS).toBe(365);
		expect(REMINDER_LOG_RETENTION_DAYS).toBe(180);
		expect(PLATFORM_AUDIT_LOG_RETENTION_DAYS).toBe(730);
	});
});

describe("deleteOldHeartbeatEvents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes heartbeat rows older than the retention window in one batch", async () => {
		mockFeedEvent.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }, { id: "3" }] as never);
		mockFeedEvent.deleteMany.mockResolvedValue({ count: 3 } as never);

		const deleted = await deleteOldHeartbeatEvents();

		expect(deleted).toBe(3);
		expect(mockFeedEvent.findMany).toHaveBeenCalledWith({
			where: {
				eventType: "heartbeat",
				receivedAt: { lt: expect.any(Date) },
			},
			select: { id: true },
			take: 5000,
		});
		const cutoff = (
			mockFeedEvent.findMany.mock.calls[0][0] as { where: { receivedAt: { lt: Date } } }
		).where.receivedAt.lt;
		const expected = Date.now() - HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockFeedEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["1", "2", "3"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockFeedEvent.findMany.mockResolvedValue([] as never);

		const deleted = await deleteOldHeartbeatEvents();

		expect(deleted).toBe(0);
		expect(mockFeedEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("respects a custom batch size", async () => {
		mockFeedEvent.findMany.mockResolvedValue([{ id: "1" }] as never);
		mockFeedEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		await deleteOldHeartbeatEvents(100);

		expect(mockFeedEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
	});
});

describe("deleteExpiredPondSettingsDrafts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes drafts untouched for 30 days, oldest first, in one batch", async () => {
		mockDraft.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }] as never);
		mockDraft.deleteMany.mockResolvedValue({ count: 2 } as never);

		const deleted = await deleteExpiredPondSettingsDrafts();

		expect(deleted).toBe(2);
		expect(mockDraft.findMany).toHaveBeenCalledWith({
			where: { updatedAt: { lt: expect.any(Date) } },
			orderBy: { updatedAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		const cutoff = (mockDraft.findMany.mock.calls[0][0] as { where: { updatedAt: { lt: Date } } })
			.where.updatedAt.lt;
		const expected = Date.now() - POND_SETTINGS_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockDraft.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["d1", "d2"] } } });
	});

	it("keeps a draft younger than the window", async () => {
		// The query filters by date; an empty result is the "all fresh" case.
		mockDraft.findMany.mockResolvedValue([] as never);

		expect(await deleteExpiredPondSettingsDrafts()).toBe(0);
		expect(mockDraft.deleteMany).not.toHaveBeenCalled();
	});

	it("respects a custom batch size", async () => {
		mockDraft.findMany.mockResolvedValue([{ id: "d1" }] as never);
		mockDraft.deleteMany.mockResolvedValue({ count: 1 } as never);

		await deleteExpiredPondSettingsDrafts(50);

		expect(mockDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
	});
});

describe("deleteOldDeviceStateEvents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNotification.findMany.mockResolvedValue([] as never);
		mockFeedRequest.findMany.mockResolvedValue([] as never);
	});

	it("deletes stale rows after 180 days, oldest first, in one batch", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "e1", metadata: null, device: { pondId: "pond-1" } },
			{ id: "e2", metadata: { note: "ok" }, device: { pondId: "pond-2" } },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 2 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(deleted).toBe(2);
		expect(mockDeviceStateEvent.findMany).toHaveBeenCalledWith({
			where: { createdAt: { lt: expect.any(Date) } },
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				metadata: true,
				device: { select: { pondId: true } },
			},
			take: 5000,
		});
		const cutoff = (
			mockDeviceStateEvent.findMany.mock.calls[0][0] as {
				where: { createdAt: { lt: Date } };
			}
		).where.createdAt.lt;
		const expected = Date.now() - DEVICE_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
		expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["e1", "e2"] } },
		});
	});

	it("keeps every row belonging to a pond with an open alert", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "open", metadata: null, device: { pondId: "pond-open" } },
			{ id: "quiet", metadata: null, device: { pondId: "pond-quiet" } },
		] as never);
		mockNotification.findMany.mockResolvedValue([{ pondId: "pond-open" }] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(deleted).toBe(1);
		expect(mockNotification.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { resolvedAt: null, autoCleared: false, supersededById: null },
				distinct: ["pondId"],
			}),
		);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["quiet"] } },
		});
	});

	it("keeps rows tied to a FeedRequest that is still pending or dispatched", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "pending", metadata: { feedRequestId: "req-pending" }, device: { pondId: "p1" } },
			{ id: "expired", metadata: { expiredRequestId: "req-expired" }, device: { pondId: "p2" } },
			{ id: "done", metadata: { feedRequestId: "req-done" }, device: { pondId: "p3" } },
		] as never);
		mockFeedRequest.findMany.mockResolvedValue([
			{ id: "req-pending" },
			{ id: "req-expired" },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		const deleted = await deleteOldDeviceStateEvents();

		expect(mockFeedRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { status: { in: ["pending", "dispatched"] } } }),
		);
		expect(deleted).toBe(1);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["done"] } },
		});
	});

	it("returns 0 without running the guard queries when nothing is stale", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([] as never);

		expect(await deleteOldDeviceStateEvents()).toBe(0);
		expect(mockNotification.findMany).not.toHaveBeenCalled();
		expect(mockFeedRequest.findMany).not.toHaveBeenCalled();
		expect(mockDeviceStateEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("reports 0 rather than deleting protected rows to make progress", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "protected", metadata: null, device: { pondId: "pond-open" } },
		] as never);
		mockNotification.findMany.mockResolvedValue([{ pondId: "pond-open" }] as never);

		expect(await deleteOldDeviceStateEvents()).toBe(0);
		expect(mockDeviceStateEvent.deleteMany).not.toHaveBeenCalled();
	});

	it("treats a non-object metadata value as having no reconciliation reference", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([
			{ id: "scalar", metadata: "note", device: { pondId: "p1" } },
		] as never);
		mockDeviceStateEvent.deleteMany.mockResolvedValue({ count: 1 } as never);

		expect(await deleteOldDeviceStateEvents()).toBe(1);
		expect(mockDeviceStateEvent.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["scalar"] } },
		});
	});

	it("respects a custom batch size", async () => {
		mockDeviceStateEvent.findMany.mockResolvedValue([] as never);

		await deleteOldDeviceStateEvents(25);

		expect(mockDeviceStateEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 25 }),
		);
	});
});

describe("deleteOldWaterTempLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes readings past 365 days, oldest first, in one batch", async () => {
		mockWaterTempLog.findMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }] as never);
		mockWaterTempLog.deleteMany.mockResolvedValue({ count: 2 } as never);

		await expect(deleteOldWaterTempLogs()).resolves.toBe(2);

		expect(mockWaterTempLog.findMany).toHaveBeenCalledWith({
			where: { recordedAt: { lt: expect.any(Date) } },
			orderBy: { recordedAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockWaterTempLog.findMany.mock.calls[0]?.[0]).recordedAt?.lt,
			WATER_TEMP_RETENTION_DAYS,
		);
		expect(mockWaterTempLog.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["w1", "w2"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockWaterTempLog.findMany.mockResolvedValue([] as never);

		await expect(deleteOldWaterTempLogs()).resolves.toBe(0);
		expect(mockWaterTempLog.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldFeedLevelLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes readings past 365 days, oldest first, in one batch", async () => {
		mockFeedLevelLog.findMany.mockResolvedValue([{ id: "f1" }] as never);
		mockFeedLevelLog.deleteMany.mockResolvedValue({ count: 1 } as never);

		await expect(deleteOldFeedLevelLogs()).resolves.toBe(1);

		expect(mockFeedLevelLog.findMany).toHaveBeenCalledWith({
			where: { recordedAt: { lt: expect.any(Date) } },
			orderBy: { recordedAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockFeedLevelLog.findMany.mock.calls[0]?.[0]).recordedAt?.lt,
			FEED_LEVEL_RETENTION_DAYS,
		);
		expect(mockFeedLevelLog.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["f1"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockFeedLevelLog.findMany.mockResolvedValue([] as never);

		await expect(deleteOldFeedLevelLogs()).resolves.toBe(0);
		expect(mockFeedLevelLog.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldNotifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes closed rows past 180 days, oldest first, in one batch", async () => {
		mockNotification.findMany.mockResolvedValue([
			{ id: "resolved" },
			{ id: "auto-cleared" },
			{ id: "superseded" },
		] as never);
		mockNotification.deleteMany.mockResolvedValue({ count: 3 } as never);

		await expect(deleteOldNotifications()).resolves.toBe(3);

		const where = ageWhere(mockNotification.findMany.mock.calls[0]?.[0]);
		expect(mockNotification.findMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ resolvedAt: { lt: expect.any(Date) } },
					{ resolvedAt: null, autoCleared: true, createdAt: { lt: expect.any(Date) } },
					{ resolvedAt: null, supersededById: { not: null }, createdAt: { lt: expect.any(Date) } },
				],
			},
			orderBy: { createdAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			(where.OR?.[0] as { resolvedAt: { lt: Date } }).resolvedAt.lt,
			NOTIFICATION_RETENTION_DAYS,
		);
		expect(mockNotification.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["resolved", "auto-cleared", "superseded"] } },
		});
	});

	it("never selects an open alert, so an open alert is never deleted", async () => {
		// An open alert is resolvedAt null AND autoCleared false AND
		// supersededById null, so it matches none of the closure branches.
		mockNotification.findMany.mockResolvedValue([] as never);

		await expect(deleteOldNotifications()).resolves.toBe(0);

		const args = mockNotification.findMany.mock.calls[0]?.[0] as {
			where?: { OR?: unknown[] };
		};
		expect(args?.where?.OR).toEqual([
			{ resolvedAt: { lt: expect.any(Date) } },
			{ resolvedAt: null, autoCleared: true, createdAt: { lt: expect.any(Date) } },
			{ resolvedAt: null, supersededById: { not: null }, createdAt: { lt: expect.any(Date) } },
		]);
		expect(mockNotification.deleteMany).not.toHaveBeenCalled();
	});

	it("respects a custom batch size", async () => {
		mockNotification.findMany.mockResolvedValue([] as never);

		await deleteOldNotifications(25);

		expect(mockNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
	});
});

describe("deleteOldCalibrationRuns", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes runs past 730 days, oldest first, in one batch", async () => {
		mockCalibrationRun.findMany.mockResolvedValue([{ id: "c1" }] as never);
		mockCalibrationRun.deleteMany.mockResolvedValue({ count: 1 } as never);

		await expect(deleteOldCalibrationRuns()).resolves.toBe(1);

		expect(mockCalibrationRun.findMany).toHaveBeenCalledWith({
			where: { createdAt: { lt: expect.any(Date) } },
			orderBy: { createdAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockCalibrationRun.findMany.mock.calls[0]?.[0]).createdAt?.lt,
			CALIBRATION_RUN_RETENTION_DAYS,
		);
		expect(mockCalibrationRun.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["c1"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockCalibrationRun.findMany.mockResolvedValue([] as never);

		await expect(deleteOldCalibrationRuns()).resolves.toBe(0);
		expect(mockCalibrationRun.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldAssistantActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes proposals past 180 days, oldest first, in one batch", async () => {
		mockAssistantAction.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }] as never);
		mockAssistantAction.deleteMany.mockResolvedValue({ count: 2 } as never);

		await expect(deleteOldAssistantActions()).resolves.toBe(2);

		expect(mockAssistantAction.findMany).toHaveBeenCalledWith({
			where: { createdAt: { lt: expect.any(Date) } },
			orderBy: { createdAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockAssistantAction.findMany.mock.calls[0]?.[0]).createdAt?.lt,
			ASSISTANT_ACTION_RETENTION_DAYS,
		);
		expect(mockAssistantAction.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["a1", "a2"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockAssistantAction.findMany.mockResolvedValue([] as never);

		await expect(deleteOldAssistantActions()).resolves.toBe(0);
		expect(mockAssistantAction.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldIssueReports", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes resolved or non-OPEN reports past 365 days, oldest first", async () => {
		mockIssueReport.findMany.mockResolvedValue([{ id: "r1" }, { id: "r2" }] as never);
		mockIssueReport.deleteMany.mockResolvedValue({ count: 2 } as never);

		await expect(deleteOldIssueReports()).resolves.toBe(2);

		const where = ageWhere(mockIssueReport.findMany.mock.calls[0]?.[0]);
		expect(mockIssueReport.findMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ resolvedAt: { lt: expect.any(Date) } },
					{ resolvedAt: null, status: { not: "OPEN" }, createdAt: { lt: expect.any(Date) } },
				],
			},
			orderBy: { createdAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			(where.OR?.[0] as { resolvedAt: { lt: Date } }).resolvedAt.lt,
			ISSUE_REPORT_RETENTION_DAYS,
		);
		expect(mockIssueReport.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["r1", "r2"] } },
		});
	});

	it("never selects an open report, so an open report is never deleted", async () => {
		// An open report has resolvedAt null and status OPEN, matching neither
		// branch of the closure filter.
		mockIssueReport.findMany.mockResolvedValue([] as never);

		await expect(deleteOldIssueReports()).resolves.toBe(0);

		const args = mockIssueReport.findMany.mock.calls[0]?.[0] as {
			where?: { OR?: unknown[] };
		};
		expect(args?.where?.OR).toEqual([
			{ resolvedAt: { lt: expect.any(Date) } },
			{ resolvedAt: null, status: { not: "OPEN" }, createdAt: { lt: expect.any(Date) } },
		]);
		expect(mockIssueReport.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldReminderLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes delivery records past 180 days by sentAt, oldest first", async () => {
		mockReminderLog.findMany.mockResolvedValue([{ id: "rl1" }] as never);
		mockReminderLog.deleteMany.mockResolvedValue({ count: 1 } as never);

		await expect(deleteOldReminderLogs()).resolves.toBe(1);

		expect(mockReminderLog.findMany).toHaveBeenCalledWith({
			where: { sentAt: { lt: expect.any(Date) } },
			orderBy: { sentAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockReminderLog.findMany.mock.calls[0]?.[0]).sentAt?.lt,
			REMINDER_LOG_RETENTION_DAYS,
		);
		expect(mockReminderLog.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["rl1"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockReminderLog.findMany.mockResolvedValue([] as never);

		await expect(deleteOldReminderLogs()).resolves.toBe(0);
		expect(mockReminderLog.deleteMany).not.toHaveBeenCalled();
	});
});

describe("deleteOldPlatformAuditLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes audit rows past 730 days, oldest first, in one batch", async () => {
		mockPlatformAuditLog.findMany.mockResolvedValue([{ id: "p1" }] as never);
		mockPlatformAuditLog.deleteMany.mockResolvedValue({ count: 1 } as never);

		await expect(deleteOldPlatformAuditLogs()).resolves.toBe(1);

		expect(mockPlatformAuditLog.findMany).toHaveBeenCalledWith({
			where: { createdAt: { lt: expect.any(Date) } },
			orderBy: { createdAt: "asc" },
			select: { id: true },
			take: 5000,
		});
		expectCutoff(
			ageWhere(mockPlatformAuditLog.findMany.mock.calls[0]?.[0]).createdAt?.lt,
			PLATFORM_AUDIT_LOG_RETENTION_DAYS,
		);
		expect(mockPlatformAuditLog.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["p1"] } },
		});
	});

	it("returns 0 and skips deleteMany when nothing is stale", async () => {
		mockPlatformAuditLog.findMany.mockResolvedValue([] as never);

		await expect(deleteOldPlatformAuditLogs()).resolves.toBe(0);
		expect(mockPlatformAuditLog.deleteMany).not.toHaveBeenCalled();
	});
});
