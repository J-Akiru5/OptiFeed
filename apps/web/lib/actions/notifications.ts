"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function markAllNotificationsRead() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) return;

	await prisma.notification.updateMany({
		where: {
			pondId: pond.id,
			read: false,
		},
		data: {
			read: true,
		},
	});

	revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
	revalidatePath("/[locale]/(dashboard)", "layout");
}

export async function acknowledgeNotification(notificationId: string) {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) return;

	await prisma.notification.update({
		where: { id: notificationId, pondId: pond.id },
		data: {
			acknowledgedAt: new Date(),
			acknowledgedBy: "demo-farmer-1",
			read: true,
		},
	});

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
