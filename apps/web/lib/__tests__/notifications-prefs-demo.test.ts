import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Notification preferences are merged, never replaced: the pond row also holds
 * the offline profile and growth target, so a save must preserve keys this
 * build does not know about. The demo-notification helper is the one place a
 * human-typed message reaches the bell, so it is sanitised before it is stored.
 */

const { prisma } = vi.hoisted(() => ({
	prisma: {
		pond: { findFirst: vi.fn(), update: vi.fn() },
		notification: { create: vi.fn() },
	},
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn(),
	requireWriteAccess: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createDemoNotification, updateNotificationPrefs } from "@/lib/actions/notifications";
import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";

const mockWrite = vi.mocked(requireWriteAccess);
const mockOwner = vi.mocked(getCurrentPondOwnerId);

beforeEach(() => {
	vi.clearAllMocks();
	mockWrite.mockResolvedValue(undefined);
	mockOwner.mockResolvedValue("farm-1");
	prisma.pond.findFirst.mockResolvedValue({ id: "pond-1", notificationPrefs: {} });
	prisma.pond.update.mockResolvedValue({});
	prisma.notification.create.mockResolvedValue({});
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

describe("createDemoNotification", () => {
	it("denies a read-only member before validating the input", async () => {
		mockWrite.mockRejectedValue(new Error("Read-only session"));

		await expect(createDemoNotification("pond-1", "INFO", "hello")).rejects.toThrow(
			"Read-only session",
		);
		expect(prisma.pond.findFirst).not.toHaveBeenCalled();
	});

	it("rejects an unknown tier", async () => {
		await expect(createDemoNotification("pond-1", "URGENT", "hello")).resolves.toEqual({
			success: false,
			error: "Invalid notification tier.",
		});
		expect(prisma.notification.create).not.toHaveBeenCalled();
	});

	it("rejects a message that is only whitespace after sanitising", async () => {
		await expect(createDemoNotification("pond-1", "INFO", " \n\t ")).resolves.toEqual({
			success: false,
			error: "Message is required.",
		});
		expect(prisma.pond.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a pond owned by another farm", async () => {
		prisma.pond.findFirst.mockResolvedValue(null);

		await expect(createDemoNotification("pond-x", "INFO", "hello")).resolves.toEqual({
			success: false,
			error: "Pond not found.",
		});
		expect(prisma.notification.create).not.toHaveBeenCalled();
	});

	it("stores one plain-text notification for the pond", async () => {
		await expect(
			createDemoNotification("pond-1", "WARNING", "Line one\nLine two", "feeding"),
		).resolves.toEqual({ success: true });

		expect(prisma.notification.create).toHaveBeenCalledWith({
			data: {
				pondId: "pond-1",
				tier: "WARNING",
				category: "feeding",
				message: "Line one Line two",
				linkTo: "/dashboard",
			},
		});
	});

	it("collapses line breaks and caps the stored message at 500 characters", async () => {
		await createDemoNotification("pond-1", "INFO", `bell\nline ${"x".repeat(600)}`);

		const message = prisma.notification.create.mock.calls[0][0].data.message;
		expect(message).toHaveLength(500);
		expect(message.startsWith("bell line ")).toBe(true);
		expect(message).not.toContain("\n");
	});

	it("writes a null category when none is given", async () => {
		await createDemoNotification("pond-1", "SUCCESS", "All good");

		expect(prisma.notification.create.mock.calls[0][0].data.category).toBeNull();
	});

	it("reports a storage failure instead of a false success", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		prisma.notification.create.mockRejectedValue(new Error("insert failed"));

		await expect(createDemoNotification("pond-1", "INFO", "hello")).resolves.toEqual({
			success: false,
			error: "Failed to create demo notification.",
		});
		spy.mockRestore();
	});
});
