import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const tx = {
		platformSetting: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
			deleteMany: vi.fn(),
		},
	};
	const db = {
		platformSetting: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return {
		db,
		tx,
		gate: vi.fn(),
		actorContext: vi.fn(),
		writePlatformAudit: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/prisma", () => ({ default: mocks.db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: mocks.gate }));
vi.mock("@/lib/actions/platform/audit", () => ({
	actorContext: mocks.actorContext,
	writePlatformAudit: mocks.writePlatformAudit,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { clearAnnouncement, publishAnnouncement } from "@/lib/actions/platform/announcements";
import {
	ANNOUNCEMENT_KEY,
	endOfDayIso,
	isAnnouncementActive,
	normalizeAnnouncement,
} from "@/lib/announcement";

const NOW = new Date("2026-10-27T12:00:00.000Z");

const valid = {
	id: "announcement-1",
	title: "Maintenance tonight",
	body: "The dashboard is read-only from 22:00 to 23:00.",
	severity: "warning" as const,
	endsAt: "2026-10-28T23:59:59.999Z",
	publishedAt: "2026-10-27T08:00:00.000Z",
	createdById: "admin-1",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.actorContext.mockResolvedValue({ id: "admin-1", temporaryGrant: false });
	mocks.writePlatformAudit.mockResolvedValue(undefined);
	mocks.db.platformSetting.findUnique.mockResolvedValue(null);
	mocks.tx.platformSetting.findUnique.mockResolvedValue(null);
	mocks.tx.platformSetting.upsert.mockResolvedValue({});
	mocks.tx.platformSetting.deleteMany.mockResolvedValue({ count: 0 });
	mocks.db.$transaction.mockImplementation(
		async (fn: (client: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx),
	);
});

describe("normalizeAnnouncement", () => {
	it("accepts a complete stored value", () => {
		expect(normalizeAnnouncement(valid)).toEqual(valid);
	});

	it("accepts a missing end date", () => {
		expect(normalizeAnnouncement({ ...valid, endsAt: null })).toMatchObject({ endsAt: null });
	});

	it("rejects malformed values instead of rendering a partial banner", () => {
		expect(normalizeAnnouncement(null)).toBeNull();
		expect(normalizeAnnouncement([])).toBeNull();
		expect(normalizeAnnouncement({ ...valid, id: "" })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, title: "x" })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, body: "   " })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, severity: "critical" })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, publishedAt: "yesterday" })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, endsAt: "later" })).toBeNull();
		expect(normalizeAnnouncement({ ...valid, title: "x".repeat(101) })).toBeNull();
	});
});

describe("isAnnouncementActive", () => {
	it("is active between publication and the end date", () => {
		expect(isAnnouncementActive(valid, NOW)).toBe(true);
	});

	it("stays active with no end date", () => {
		expect(isAnnouncementActive({ ...valid, endsAt: null }, NOW)).toBe(true);
	});

	it("is inactive after the end date", () => {
		expect(isAnnouncementActive({ ...valid, endsAt: "2026-10-26T23:59:59.999Z" }, NOW)).toBe(false);
	});

	it("is inactive before it was published", () => {
		expect(isAnnouncementActive({ ...valid, publishedAt: "2026-10-28T00:00:00.000Z" }, NOW)).toBe(
			false,
		);
	});
});

describe("endOfDayIso", () => {
	it("returns the end of the UTC day", () => {
		expect(endOfDayIso("2026-10-28")).toBe("2026-10-28T23:59:59.999Z");
	});

	it("rejects impossible days and other formats", () => {
		expect(endOfDayIso("2026-02-31")).toBeNull();
		expect(endOfDayIso("28-10-2026")).toBeNull();
	});
});

describe("getActiveAnnouncement", () => {
	it("returns the stored announcement while it is active", async () => {
		vi.resetModules();
		mocks.db.platformSetting.findUnique.mockResolvedValue({
			value: { ...valid, endsAt: null },
		});
		const { getActiveAnnouncement } = await import("@/lib/settings/announcement");

		await expect(getActiveAnnouncement()).resolves.toMatchObject({ id: valid.id });
		expect(mocks.db.platformSetting.findUnique).toHaveBeenCalledWith({
			where: { key: ANNOUNCEMENT_KEY },
			select: { value: true },
		});
	});

	it("hides an expired announcement", async () => {
		vi.resetModules();
		mocks.db.platformSetting.findUnique.mockResolvedValue({
			value: { ...valid, endsAt: "2020-01-01T00:00:00.000Z" },
		});
		const { getActiveAnnouncement } = await import("@/lib/settings/announcement");

		await expect(getActiveAnnouncement()).resolves.toBeNull();
	});

	it("fails closed on a corrupt value or a read error", async () => {
		vi.resetModules();
		mocks.db.platformSetting.findUnique.mockResolvedValueOnce({ value: { title: "broken" } });
		const { getActiveAnnouncement } = await import("@/lib/settings/announcement");

		await expect(getActiveAnnouncement()).resolves.toBeNull();

		mocks.db.platformSetting.findUnique.mockRejectedValueOnce(new Error("db down"));
		await expect(getActiveAnnouncement()).resolves.toBeNull();
	});
});

describe("publishAnnouncement", () => {
	const input = {
		title: "Maintenance tonight",
		body: "Read-only from 22:00 to 23:00.",
		severity: "warning" as const,
		endsOn: "2099-12-31",
	};

	it("requires a platform admin before any write", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(publishAnnouncement(input, "Scheduled maintenance notice")).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
	});

	it("validates the payload and the reason", async () => {
		await expect(
			publishAnnouncement({ ...input, title: "x" }, "Scheduled maintenance notice"),
		).resolves.toEqual({ error: expect.any(String) });

		await expect(publishAnnouncement(input, "too short")).resolves.toEqual({
			error: expect.stringContaining("reason"),
		});
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
	});

	it("rejects an end date in the past", async () => {
		await expect(
			publishAnnouncement({ ...input, endsOn: "2020-01-01" }, "Scheduled maintenance notice"),
		).resolves.toEqual({ error: expect.stringContaining("today or later") });
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
	});

	it("stores the setting and writes exactly one audit row", async () => {
		mocks.tx.platformSetting.findUnique.mockResolvedValue({
			value: { ...valid, id: "old" },
		});

		const result = await publishAnnouncement(input, "Scheduled maintenance notice");

		expect(result).toEqual({ success: true });
		expect(mocks.tx.platformSetting.upsert).toHaveBeenCalledTimes(1);
		const upsert = mocks.tx.platformSetting.upsert.mock.calls[0][0];
		expect(upsert.where).toEqual({ key: ANNOUNCEMENT_KEY });
		expect(upsert.create.value).toMatchObject({
			title: input.title,
			body: input.body,
			severity: "warning",
			endsAt: "2099-12-31T23:59:59.999Z",
			createdById: "admin-1",
		});
		expect(upsert.create.value.id).toEqual(expect.any(String));

		expect(mocks.writePlatformAudit).toHaveBeenCalledTimes(1);
		expect(mocks.writePlatformAudit).toHaveBeenCalledWith(
			mocks.tx,
			expect.objectContaining({
				actorUserId: "admin-1",
				action: "platform.announcement.publish",
				targetType: "platform_setting",
				targetId: ANNOUNCEMENT_KEY,
				reason: "Scheduled maintenance notice",
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalled();
	});
});

describe("clearAnnouncement", () => {
	it("requires a platform admin", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(clearAnnouncement("No longer needed for anyone")).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.db.$transaction).not.toHaveBeenCalled();
	});

	it("deletes the setting and audits the clear", async () => {
		mocks.tx.platformSetting.findUnique.mockResolvedValue({ value: valid });

		const result = await clearAnnouncement("No longer needed for anyone");

		expect(result).toEqual({ success: true });
		expect(mocks.tx.platformSetting.deleteMany).toHaveBeenCalledWith({
			where: { key: ANNOUNCEMENT_KEY },
		});
		expect(mocks.writePlatformAudit).toHaveBeenCalledWith(
			mocks.tx,
			expect.objectContaining({
				action: "platform.announcement.clear",
				before: valid,
			}),
		);
	});
});
