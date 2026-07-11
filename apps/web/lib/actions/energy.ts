"use server";

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function requestFeed(deviceId: string, grams: number) {
	try {
		await prisma.feedRequest.create({
			data: {
				deviceId,
				grams,
				status: "pending",
			},
		});

		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return { success: true };
	} catch (error) {
		console.error("Failed to create feed request:", error);
		return { success: false, error: "Failed to create feed request" };
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
		},
	});
	return token;
}
