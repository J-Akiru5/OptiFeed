"use server";

import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { updateScheduleCommand } from "./schedule";

export async function updatePondSettings(
	pondId: string,
	feedingRatePct: number,
	feedsPerDay: number,
) {
	try {
		const ownerId = await getCurrentPondOwnerId();
		const pond = await prisma.pond.findFirst({
			where: { id: pondId, ownerId },
		});

		if (!pond) {
			return { success: false, error: "Pond not found" };
		}

		const energyDevice = await prisma.energyDevice.findFirst({
			where: { pondId },
			select: { id: true },
		});

		if (energyDevice) {
			const fmt = (d: Date) =>
				`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

			await updateScheduleCommand(pondId, energyDevice.id, {
				scheduleStart: fmt(pond.scheduleStart),
				scheduleEnd: fmt(pond.scheduleEnd),
				feedsPerDay,
				feedingRatePct,
			});

			await prisma.deviceStateEvent.create({
				data: {
					deviceId: energyDevice.id,
					eventType: "settings_changed",
					source: "user",
					actorId: ownerId,
					metadata: { feedingRatePct, feedsPerDay },
				},
			});

			revalidatePath("/[locale]/(dashboard)", "layout");
			return { success: true };
		}

		await prisma.pond.update({
			where: { id: pondId },
			data: {
				feedingRatePct,
				feedsPerDay,
			},
		});

		revalidatePath("/[locale]/(dashboard)", "layout");
		return { success: true };
	} catch (error) {
		console.error("Failed to update pond settings:", error);
		return { success: false, error: "Failed to update pond settings" };
	}
}
