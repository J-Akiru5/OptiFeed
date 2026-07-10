"use server";

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function setRelayState(deviceId: string, state: boolean) {
	try {
		await prisma.energyDevice.update({
			where: { id: deviceId },
			data: { relayState: state },
		});

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to update relay state:", error);
		return { success: false, error: "Failed to update relay state" };
	}
}

export async function registerEnergyDevice(
	mac: string,
	label: string,
	pondId?: string,
): Promise<string> {
	const token = `esp32-tok-${randomUUID()}`;
	await prisma.energyDevice.create({
		data: {
			mac,
			token,
			label,
			pondId: pondId ?? null,
			relayState: true,
		},
	});
	return token;
}
