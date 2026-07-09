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

	// Revalidate any pages that might show notifications
	revalidatePath("/[locale]/(dashboard)/dashboard/notifications", "page");
	revalidatePath("/[locale]/(dashboard)", "layout");
}

export async function createDemoNotification(pondId: string, tier: string, message: string) {
	// A helper specifically for testing the Realtime UI
	await prisma.notification.create({
		data: {
			pondId,
			tier,
			message,
			linkTo: "/en/dashboard",
		},
	});
}
