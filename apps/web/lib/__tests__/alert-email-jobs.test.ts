import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two alert-email jobs: one email per CRITICAL episode, one digest per
 * recipient for the previous Manila day.
 */

const mocks = vi.hoisted(() => ({
	notification: { findMany: vi.fn() },
	reminderLog: { findMany: vi.fn(), upsert: vi.fn() },
	platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
}));

const sender = vi.hoisted(() => ({
	isAlertEmailConfigured: vi.fn(() => true),
	sendCriticalAlertEmail: vi.fn(async () => ({ ok: true })),
	sendAlertDigestEmail: vi.fn(async () => ({ ok: true })),
}));

const audiences = vi.hoisted(() => ({ resolvePondAlertAudiences: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ default: mocks }));
vi.mock("@/lib/notify/alert-email", () => sender);
vi.mock("@/lib/notifications/alert-recipients", () => audiences);
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { manilaDayRange } from "@/lib/feed/day";
import {
	ALERT_DIGEST_SETTING_KEY,
	sendCriticalAlertEmails,
	sendDailyAlertDigest,
} from "@/lib/notifications/alert-email-jobs";

const NOW = new Date("2026-11-02T01:00:00.000Z"); // 09:00 Manila
const YESTERDAY = new Date("2026-11-01T02:00:00.000Z");

function notification(overrides: Record<string, unknown> = {}) {
	return {
		id: "notification-1",
		pondId: "pond-a",
		category: "connectivity",
		tier: "CRITICAL",
		message: "Feeder A is offline",
		createdAt: YESTERDAY,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	sender.isAlertEmailConfigured.mockReturnValue(true);
	sender.sendCriticalAlertEmail.mockResolvedValue({ ok: true });
	sender.sendAlertDigestEmail.mockResolvedValue({ ok: true });
	mocks.notification.findMany.mockResolvedValue([]);
	mocks.reminderLog.findMany.mockResolvedValue([]);
	mocks.reminderLog.upsert.mockResolvedValue({});
	mocks.platformSetting.findUnique.mockResolvedValue(null);
	mocks.platformSetting.upsert.mockResolvedValue({});
	audiences.resolvePondAlertAudiences.mockResolvedValue(
		new Map([
			[
				"pond-a",
				{
					pondId: "pond-a",
					pondName: "Pond A",
					farmId: "farm-a",
					orgId: "org-a",
					roles: ["OWNER"],
					emails: ["owner@example.test"],
				},
			],
		]),
	);
});

describe("sendCriticalAlertEmails", () => {
	it("does nothing at all when alert email is not configured", async () => {
		sender.isAlertEmailConfigured.mockReturnValue(false);

		expect(await sendCriticalAlertEmails(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
		expect(mocks.notification.findMany).not.toHaveBeenCalled();
		expect(mocks.reminderLog.upsert).not.toHaveBeenCalled();
	});

	it("sends one email per open CRITICAL episode and records the attempt", async () => {
		mocks.notification.findMany.mockResolvedValue([
			notification(),
			notification({ id: "notification-2", category: "system", message: "Safe mode" }),
		]);
		audiences.resolvePondAlertAudiences.mockResolvedValue(
			new Map([
				[
					"pond-a",
					{
						pondId: "pond-a",
						pondName: "Pond A",
						farmId: "farm-a",
						orgId: "org-a",
						roles: ["OWNER"],
						emails: ["owner@example.test"],
					},
				],
			]),
		);

		const result = await sendCriticalAlertEmails(NOW);

		expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
		expect(sender.sendCriticalAlertEmail).toHaveBeenCalledTimes(2);
		expect(sender.sendCriticalAlertEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: ["owner@example.test"],
				pondName: "Pond A",
				message: "Feeder A is offline",
			}),
			expect.anything(),
		);
		expect(mocks.reminderLog.upsert).toHaveBeenCalledTimes(2);
		expect(mocks.reminderLog.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { dedupeKey: "alert-email:notification-1" },
				create: expect.objectContaining({ status: "SENT", channel: "email" }),
			}),
		);
	});

	it("does not send the same episode twice", async () => {
		mocks.notification.findMany.mockResolvedValue([notification()]);
		mocks.reminderLog.findMany.mockResolvedValue([
			{ dedupeKey: "alert-email:notification-1", status: "SENT", attempts: 1 },
		]);

		expect(await sendCriticalAlertEmails(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
		expect(sender.sendCriticalAlertEmail).not.toHaveBeenCalled();
	});

	it("retries a failed attempt until the cap", async () => {
		mocks.notification.findMany.mockResolvedValue([notification()]);
		mocks.reminderLog.findMany.mockResolvedValue([
			{ dedupeKey: "alert-email:notification-1", status: "FAILED", attempts: 1 },
		]);

		expect((await sendCriticalAlertEmails(NOW)).sent).toBe(1);
		expect(sender.sendCriticalAlertEmail).toHaveBeenCalledTimes(1);

		mocks.reminderLog.findMany.mockResolvedValue([
			{ dedupeKey: "alert-email:notification-1", status: "FAILED", attempts: 3 },
		]);

		expect((await sendCriticalAlertEmails(NOW)).sent).toBe(0);
		expect(sender.sendCriticalAlertEmail).toHaveBeenCalledTimes(1);
	});

	it("records a skip when no account has an address, without calling Resend", async () => {
		mocks.notification.findMany.mockResolvedValue([notification()]);
		audiences.resolvePondAlertAudiences.mockResolvedValue(
			new Map([
				[
					"pond-a",
					{
						pondId: "pond-a",
						pondName: "Pond A",
						farmId: "farm-a",
						orgId: "org-a",
						roles: ["OWNER"],
						emails: [],
					},
				],
			]),
		);

		expect(await sendCriticalAlertEmails(NOW)).toEqual({ sent: 0, failed: 0, skipped: 1 });
		expect(sender.sendCriticalAlertEmail).not.toHaveBeenCalled();
		expect(mocks.reminderLog.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ create: expect.objectContaining({ status: "SKIPPED" }) }),
		);
	});
});

describe("sendDailyAlertDigest", () => {
	it("summarizes the previous completed Manila day, once", async () => {
		mocks.notification.findMany.mockResolvedValue([
			{ pondId: "pond-a", tier: "WARNING", message: "Hopper at 12 %", createdAt: YESTERDAY },
			{ pondId: "pond-a", tier: "WARNING", message: "Missed a feeding", createdAt: YESTERDAY },
		]);

		const result = await sendDailyAlertDigest(NOW);

		expect(result).toMatchObject({ sent: 1, failed: 0 });
		expect(sender.sendAlertDigestEmail).toHaveBeenCalledTimes(1);
		expect(sender.sendAlertDigestEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: ["owner@example.test"],
				items: expect.arrayContaining([
					expect.objectContaining({ message: "Hopper at 12 %" }),
					expect.objectContaining({ message: "Missed a feeding" }),
				]),
			}),
			expect.anything(),
		);
		expect(mocks.platformSetting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ where: { key: ALERT_DIGEST_SETTING_KEY } }),
		);
	});

	it("does not send twice for the same day", async () => {
		mocks.platformSetting.findUnique.mockResolvedValue({
			value: { day: "2026-11-01" },
		});

		expect(await sendDailyAlertDigest(NOW)).toEqual({ sent: 0, failed: 0, day: "2026-11-01" });
		expect(mocks.notification.findMany).not.toHaveBeenCalled();
	});

	it("marks an empty day so the marker does not repeat the query", async () => {
		mocks.notification.findMany.mockResolvedValue([]);

		const result = await sendDailyAlertDigest(NOW);

		expect(result.sent).toBe(0);
		expect(sender.sendAlertDigestEmail).not.toHaveBeenCalled();
		expect(mocks.platformSetting.upsert).toHaveBeenCalled();
	});

	it("queries exactly the previous Manila day", async () => {
		await sendDailyAlertDigest(NOW);

		const where = (
			mocks.notification.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
		).where;
		const start = manilaDayRange(NOW.getTime()).start;
		expect(where.createdAt).toEqual({
			gte: new Date(start.getTime() - 24 * 60 * 60 * 1000),
			lt: start,
		});
		expect(where.category).toEqual({ in: ["pellet", "feeding"] });
	});
});
