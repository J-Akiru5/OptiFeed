"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updatePondSettings(
	pondId: string,
	feedingRatePct: number,
	feedsPerDay: number,
) {
	try {
		await prisma.pond.update({
			where: { id: pondId },
			data: {
				feedingRatePct,
				feedsPerDay,
			},
		});

		// Revalidate the dashboard layout to ensure all pages (like schedule and history) reflect the new settings
		revalidatePath("/[locale]/(dashboard)", "layout");
		return { success: true };
	} catch (error) {
		console.error("Failed to update pond settings:", error);
		return { success: false, error: "Failed to update pond settings" };
	}
}
