"use server";

import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function setDeviceTime(deviceId: string, customTime: string) {
	try {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return { success: false, error: "Not authenticated" };

		const device = await prisma.energyDevice.findFirst({
			where: { id: deviceId, pond: { ownerId } },
			select: { id: true },
		});
		if (!device) return { success: false, error: "Device not found" };

		const parsedDate = new Date(customTime);
		if (Number.isNaN(parsedDate.getTime())) {
			return { success: false, error: "Invalid date format" };
		}

		await prisma.deviceStateEvent.create({
			data: {
				deviceId,
				eventType: "set_time",
				source: "user",
				actorId: ownerId,
				metadata: {
					customTime: parsedDate.toISOString(),
				},
				deviceTime: parsedDate.toISOString(),
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard/schedule", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");

		return { success: true };
	} catch (error) {
		console.error("Failed to set device time:", error);
		return { success: false, error: "Failed to set device time" };
	}
}
