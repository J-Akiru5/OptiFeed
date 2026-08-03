"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function markAllNotificationsRead() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

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
					actorId: "demo-farmer-1",
					metadata: { scope: "all", count: result.count },
				},
			});
		}
	}

	revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
	revalidatePath("/[locale]/(dashboard)", "layout");
}

export async function acknowledgeNotification(notificationId: string) {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

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
			acknowledgedBy: "demo-farmer-1",
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
				actorId: "demo-farmer-1",
				metadata: {
					notificationId,
					tier: notification.tier,
					category: notification.category ?? null,
				},
			},
		});
	}

	revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
}

export async function createDemoNotification(
	pondId: string,
	tier: string,
	message: string,
	category?: string,
) {
	await prisma.notification.create({
		data: {
			pondId,
			tier,
			category: category ?? null,
			message,
			linkTo: "/en/dashboard",
		},
	});
}
