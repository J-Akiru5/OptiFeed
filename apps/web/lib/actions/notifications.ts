"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { type NotificationPrefs, formatZodError, notificationPrefsSchema } from "@/lib/limits";
import prisma from "@/lib/prisma";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { revalidatePath } from "next/cache";

const DEMO_NOTIFICATION_TIERS = ["CRITICAL", "WARNING", "INFO", "SUCCESS"] as const;
const DEMO_MESSAGE_MAX_LENGTH = 500;

/** Collapse control characters and cap length — notification text is data, never markup. */
function sanitizeNotificationMessage(message: string, maxLen = DEMO_MESSAGE_MAX_LENGTH): string {
	return message
		.replace(/[\r\n]+/g, " ")
		.replace(/[^\S ]+/g, "")
		.trim()
		.slice(0, maxLen);
}

export type NotificationActionResult =
	| { success: true; count: number }
	| { success: false; error: string };

/** Pending = never read and never acknowledged. Rows the reader has handled drop out. */
const PENDING_NOTIFICATION_WHERE = {
	read: false,
	acknowledgedAt: null,
} as const;

/**
 * Mark every pending notification of the signed-in owner as read and
 * acknowledged (#219).
 *
 * Scope is the owner, not one pond and not the loaded page: the farm's bell
 * counts the active pond, the page paginates, and a farm can hold several
 * ponds, so a pond-scoped write left most rows pending. "Mark as read" is the
 * bulk form of "Acknowledge" here (it has always written the
 * `notification_acknowledged` audit event), so it also stamps
 * `acknowledgedAt`/`acknowledgedBy`; otherwise every row kept offering
 * "Acknowledge" after the reader had dismissed it.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
	// Guard outside try: a denied VIEWER must see the write-access reason, not
	// the generic catch-all log below.
	await requireWriteAccess();
	try {
		const ownerId = await getCurrentPondOwnerId();

		// Per-pond counts for the audit trail, read once. This is a bounded
		// aggregate, not one query per pond.
		const groups = await prisma.notification.groupBy({
			by: ["pondId"],
			where: {
				...PENDING_NOTIFICATION_WHERE,
				pond: { ownerId },
			},
			_count: { _all: true },
		});

		if (groups.length === 0) {
			return { success: true, count: 0 };
		}

		const acknowledgedAt = new Date();
		// One statement for the whole farm. The owner relation is the scope, so
		// another tenant's rows can never match (issue #339).
		const result = await prisma.notification.updateMany({
			where: {
				...PENDING_NOTIFICATION_WHERE,
				pond: { ownerId },
			},
			data: {
				read: true,
				acknowledgedAt,
				acknowledgedBy: ownerId,
			},
		});

		// One batched device lookup for every pond in the batch, then one
		// createMany. This replaces the old findFirst-inside-a-loop N+1 while
		// keeping one audit row per pond that had pending alerts.
		if (result.count > 0) {
			const pondIds = groups.map((group) => group.pondId);
			const devices = await prisma.energyDevice.findMany({
				where: { pondId: { in: pondIds } },
				select: { id: true, pondId: true },
				orderBy: { createdAt: "asc" },
			});

			const deviceByPond = new Map<string, string>();
			for (const device of devices) {
				if (device.pondId && !deviceByPond.has(device.pondId)) {
					deviceByPond.set(device.pondId, device.id);
				}
			}

			const events = groups.flatMap((group) => {
				const deviceId = deviceByPond.get(group.pondId);
				if (!deviceId) return [];
				return [
					{
						deviceId,
						eventType: "notification_acknowledged",
						source: "user",
						actorId: ownerId,
						metadata: { scope: "all", count: group._count._all },
					},
				];
			});

			if (events.length > 0) {
				await prisma.deviceStateEvent.createMany({ data: events });
			}
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
		revalidatePath("/[locale]/(dashboard)", "layout");

		return { success: true, count: result.count };
	} catch (error) {
		console.error("Failed to mark all notifications read:", error);
		return { success: false, error: "Could not update the notifications. Try again." };
	}
}

/**
 * Acknowledge one notification of the signed-in owner.
 *
 * Ownership is checked through the pond relation (`Notification` has no user
 * column), so a notification belonging to another farm is never found and never
 * updated, whichever pond is currently selected.
 */
export async function acknowledgeNotification(
	notificationId: string,
): Promise<NotificationActionResult> {
	// Guard outside try: a denied VIEWER must see the write-access reason.
	await requireWriteAccess();
	try {
		if (typeof notificationId !== "string" || notificationId.length === 0) {
			return { success: false, error: "Notification not found." };
		}

		const ownerId = await getCurrentPondOwnerId();
		const existing = await prisma.notification.findFirst({
			where: { id: notificationId, pond: { ownerId } },
			select: { id: true, pondId: true, tier: true, category: true, acknowledgedAt: true },
		});

		if (!existing) {
			return { success: false, error: "Notification not found." };
		}
		if (existing.acknowledgedAt) {
			revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
			return { success: true, count: 0 };
		}

		// Conditional update: a second tab (or a double tap) that already
		// acknowledged the row must not write a second audit event.
		const updated = await prisma.notification.updateMany({
			where: { id: existing.id, acknowledgedAt: null },
			data: {
				acknowledgedAt: new Date(),
				acknowledgedBy: ownerId,
				read: true,
			},
		});

		if (updated.count > 0) {
			const energyDevice = await prisma.energyDevice.findFirst({
				where: { pondId: existing.pondId },
				select: { id: true },
			});

			if (energyDevice) {
				await prisma.deviceStateEvent.create({
					data: {
						deviceId: energyDevice.id,
						eventType: "notification_acknowledged",
						source: "user",
						actorId: ownerId,
						metadata: {
							notificationId: existing.id,
							tier: existing.tier,
							category: existing.category ?? null,
						},
					},
				});
			}
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
		return { success: true, count: updated.count };
	} catch (error) {
		console.error("Failed to acknowledge notification:", error);
		return { success: false, error: "Could not update the notification. Try again." };
	}
}

/**
 * Persist notification preferences without discarding keys this build does not
 * know about. Legacy rows may only contain the three feeding/device flags; the
 * schema fills the reminder flags with `true` while unknown keys survive the
 * merge for forward compatibility.
 */
export async function updateNotificationPrefs(
	pondId: string,
	prefs: Partial<NotificationPrefs>,
): Promise<{ success: boolean; error?: string }> {
	try {
		await requireWriteAccess();
		const parsed = notificationPrefsSchema.safeParse(prefs);
		if (!parsed.success) {
			return { success: false, error: formatZodError(parsed.error) };
		}

		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
			select: { id: true, notificationPrefs: true },
		});
		if (!pond) return { success: false, error: "Pond not found" };

		const existing =
			pond.notificationPrefs !== null &&
			typeof pond.notificationPrefs === "object" &&
			!Array.isArray(pond.notificationPrefs)
				? (pond.notificationPrefs as Record<string, unknown>)
				: {};

		await prisma.pond.update({
			where: { id: pondId },
			data: {
				notificationPrefs: { ...existing, ...parsed.data } as unknown as InputJsonValue,
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/settings/profile", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to update notification prefs:", error);
		return { success: false, error: "Failed to update notification preferences" };
	}
}

export async function createDemoNotification(
	pondId: string,
	tier: string,
	message: string,
	category?: string,
): Promise<{ success: true } | { success: false; error: string }> {
	await requireWriteAccess();

	if (!DEMO_NOTIFICATION_TIERS.includes(tier as (typeof DEMO_NOTIFICATION_TIERS)[number])) {
		return { success: false, error: "Invalid notification tier." };
	}
	const safeMessage = sanitizeNotificationMessage(message);
	if (!safeMessage) return { success: false, error: "Message is required." };

	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
			select: { id: true },
		});

		if (!pond) return { success: false, error: "Pond not found." };

		await prisma.notification.create({
			data: {
				pondId,
				tier,
				category: category ?? null,
				message: safeMessage,
				linkTo: "/dashboard",
			},
		});

		return { success: true };
	} catch (error) {
		console.error("Failed to create demo notification:", error);
		return { success: false, error: "Failed to create demo notification." };
	}
}
