import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Notification preferences are merged, never replaced: the pond row also holds
 * the offline profile and growth target, so a save must preserve keys this
 * build does not know about.
 */

const { prisma } = vi.hoisted(() => ({
	prisma: {
		pond: { findFirst: vi.fn(), update: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn(),
	requireWriteAccess: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateNotificationPrefs } from "@/lib/actions/notifications";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";

const mockWrite = vi.mocked(requireWriteAccess);
const mockOwner = vi.mocked(getCurrentPondOwnerId);

beforeEach(() => {
	vi.clearAllMocks();
	mockWrite.mockResolvedValue(undefined);
	mockOwner.mockResolvedValue("farm-1");
	prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", notificationPrefs: {} });
	prisma.pond.update.mockResolvedValue({});
});

describe("updateNotificationPrefs", () => {
	it("denies a read-only member without touching the pond", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mockWrite.mockRejectedValue(new Error("Read-only session"));

		await expect(updateNotificationPrefs("pond-1", {})).resolves.toEqual({
			success: false,
			error: "Failed to update notification preferences",
		});
		expect(prisma.pond.findFirst).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("rejects a non-boolean flag with the field message", async () => {
		await expect(
			updateNotificationPrefs("pond-1", { missedFeeding: "yes" as never }),
		).resolves.toEqual({ success: false, error: expect.stringContaining("missedFeeding") });
		expect(prisma.pond.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a pond owned by another farm", async () => {
		prisma.pond.findFirst.mockResolvedValue(null);

		await expect(updateNotificationPrefs("pond-x", {})).resolves.toEqual({
			success: false,
			error: "Pond not found",
		});
		expect(prisma.pond.findFirst).toHaveBeenCalledWith({
			where: { id: "pond-x", ownerId: "farm-1" },
			select: { id: true, notificationPrefs: true },
		});
		expect(prisma.pond.update).not.toHaveBeenCalled();
	});

	it("merges the parsed flags into the existing preferences", async () => {
		prisma.pond.findFirst.mockResolvedValue({
			id: "pond-1",
			notificationPrefs: {
				hopperLowPct: 15,
				profile: { areaM2: 100 },
				unknownFutureKey: "keep me",
			},
		});

		await expect(updateNotificationPrefs("pond-1", { missedFeeding: false })).resolves.toEqual({
			success: true,
		});

		const data = prisma.pond.update.mock.calls[0][0].data.notificationPrefs;
		expect(data).toMatchObject({
			hopperLowPct: 15,
			missedFeeding: false,
			profile: { areaM2: 100 },
			unknownFutureKey: "keep me",
		});
		// The schema fills the flags the caller did not send with their defaults.
		expect(data.samplingReminders).toBe(true);
	});

	it("starts from an empty object when the stored value is not an object", async () => {
		prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", notificationPrefs: ["legacy"] });

		await updateNotificationPrefs("pond-1", { missedFeeding: true });

		const data = prisma.pond.update.mock.calls[0][0].data.notificationPrefs;
		expect(data).not.toHaveProperty("0");
		expect(data).toMatchObject({ missedFeeding: true });
	});

	it("reports a storage failure instead of a false success", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		prisma.pond.update.mockRejectedValue(new Error("write failed"));

		await expect(updateNotificationPrefs("pond-1", {})).resolves.toEqual({
			success: false,
			error: "Failed to update notification preferences",
		});
		spy.mockRestore();
	});
});
