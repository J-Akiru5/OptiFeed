"use server";

import { resolveActivePond } from "@/lib/auth/pond-access";
import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { type FcrCalculationInput, calculateFeedRequirement } from "@/lib/fcr-calculation";
import { getActivePondId } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";

export async function calculateFcrFeed(input: FcrCalculationInput) {
	try {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return { success: false, error: "Not authenticated" };

		// Use the pond the farmer actually has selected. `findFirst` with no
		// ordering could pick any ACTIVE pond, so the calculator showed another
		// pond's FCR on multi-pond farms.
		const pond = await resolveActivePond(ownerId, await getActivePondId());
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
