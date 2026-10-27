import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The missed-feeding dedupe key is per farm calendar day. Building it from the
 * UTC date put the rollover at 08:00 Asia/Manila, so a device could raise two
 * "daily" alerts on one local day (and none across the local midnight).
 */

const { db, tx } = vi.hoisted(() => {
	const tx = { reminderLog: { create: vi.fn() }, notification: { create: vi.fn() } };
	return {
		tx,
		db: {
			pond: { findUnique: vi.fn() },
			$transaction: vi.fn(),
		},
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/settings/org", () => ({
	getOrgSettingsForFarm: vi.fn(async () => ({
		orgId: "org-1",
		settings: {
			defaultFeedingRatePct: 3,
			hopperLowPct: 20,
			offlineAfterMin: 30,
			missedFeedingAlerts: true,
			alertRoles: ["OWNER", "ADMIN"],
			deviceRegistration: "ADMIN_APPROVAL",
		},
	})),
	getOrgAlertRoles: vi.fn(async () => ["OWNER", "ADMIN"]),
}));

import { recordMissedFeedingAlert } from "@/lib/settings/missed-feeding";

beforeEach(() => {
	vi.clearAllMocks();
	db.pond.findUnique.mockResolvedValue({
		ownerId: "farm-1",
		notificationPrefs: null,
	} as never);
	tx.reminderLog.create.mockResolvedValue({} as never);
	tx.notification.create.mockResolvedValue({} as never);
	db.$transaction.mockImplementation((async (fn: (client: typeof tx) => Promise<unknown>) =>
		fn(tx)) as never);
});

describe("missed-feeding dedupe day", () => {
	it("keys the alert on the farm calendar day, not the UTC day", async () => {
		// 23:30 UTC on 10-27 is 07:30 on 10-28 in Asia/Manila.
		const result = await recordMissedFeedingAlert({
			deviceId: "dev-1",
			deviceLabel: "Feeder A",
			pondId: "pond-1",
			grams: 120,
			reason: "daily_cap",
			timestamp: "2026-10-27T23:30:00.000Z",
		});

		expect(result).toEqual({ created: true });
		expect(tx.reminderLog.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				dedupeKey: "missed_feeding:dev-1:2026-10-28",
			}),
		});
	});
});
