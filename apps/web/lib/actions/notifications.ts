"use server";

import { resolveActivePond } from "@/lib/auth/pond-access";
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

export async function markAllNotificationsRead() {
	// Guard outside try: a denied VIEWER must see the write-access reason, not
	// the generic catch-all log below.
	await requireWriteAccess();
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await resolveActivePond(ownerId);

		if (!pond) return;

		const result = await prisma.notification.updateMany({
			where: {
				pondId: pond.id,
				read: false,
			},
			data: {
				read: true,
			},
		});

		if (result.count > 0) {
			const energyDevice = await prisma.energyDevice.findFirst({
				where: { pondId: pond.id },
				select: { id: true },
			});

			if (energyDevice) {
				await prisma.deviceStateEvent.create({
					data: {
						deviceId: energyDevice.id,
						eventType: "notification_acknowledged",
						source: "user",
						actorId: ownerId,
						metadata: { scope: "all", count: result.count },
					},
				});
			}
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
		revalidatePath("/[locale]/(dashboard)", "layout");
	} catch (error) {
		console.error("Failed to mark all notifications read:", error);
	}
}

export async function acknowledgeNotification(notificationId: string) {
	// Guard outside try: a denied VIEWER must see the write-access reason.
	await requireWriteAccess();
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await resolveActivePond(ownerId);

		if (!pond) return;

		const existing = await prisma.notification.findFirst({
			where: { id: notificationId, pondId: pond.id },
			select: { acknowledgedAt: true },
		});

		if (!existing) return;
		if (existing.acknowledgedAt) {
			revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
			return;
		}

		const notification = await prisma.notification.update({
			where: { id: notificationId, pondId: pond.id },
			data: {
				acknowledgedAt: new Date(),
				acknowledgedBy: ownerId,
				read: true,
			},
		});

		const energyDevice = await prisma.energyDevice.findFirst({
			where: { pondId: pond.id },
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
						notificationId,
						tier: notification.tier,
						category: notification.category ?? null,
					},
				},
			});
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
	} catch (error) {
		console.error("Failed to acknowledge notification:", error);
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
