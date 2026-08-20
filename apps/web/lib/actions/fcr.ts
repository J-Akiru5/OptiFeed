"use server";

import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { type FcrCalculationInput, calculateFeedRequirement } from "@/lib/fcr-calculation";
import prisma from "@/lib/prisma";

export async function calculateFcrFeed(input: FcrCalculationInput) {
	try {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return { success: false, error: "Not authenticated" };

		const pond = await prisma.pond.findFirst({ where: { ownerId } });
		if (!pond) return { success: false, error: "No pond found" };

		const fcrReports = await prisma.fcrReport.findMany({
			where: { pondId: pond.id },
			orderBy: { periodEnd: "asc" },
		});

		const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0;

		const result = calculateFeedRequirement({ ...input, currentFcr: latestFcr });

		return { success: true, ...result, latestFcr };
	} catch (error) {
		console.error("Failed to calculate FCR feed:", error);
		return { success: false, error: "Failed to calculate feed requirement" };
	}
}
