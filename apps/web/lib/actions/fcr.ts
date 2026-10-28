"use server";

import { getCurrentPondOwnerIdSafe } from "@/lib/auth/session";
import { calculateFeedRequirement } from "@/lib/fcr-calculation";
import prisma from "@/lib/prisma";

export interface FcrFeedRequest {
	/** The pond the calculator is shown for. Never inferred from "any active pond". */
	pondId: string;
	/** Current mean body weight of one fish, in kg. */
	currentWeightKg: number;
	/** Target mean body weight of one fish, in kg. */
	targetWeightKg: number;
	days: number;
	/** Overrides the pond's stored count when the farmer is experimenting. */
	population?: number | null;
	feedsPerDay?: number | null;
}

export async function calculateFcrFeed(input: FcrFeedRequest) {
	try {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return { success: false, error: "Not authenticated" };

		const pond = await prisma.pond.findFirst({
			where: { id: input.pondId, ownerId, status: "ACTIVE" },
			select: { population: true },
		});
		if (!pond) return { success: false, error: "Pond not found" };

		const population = input.population ?? pond.population ?? 0;
		if (!population || population <= 0) {
			return {
				success: false,
				error: "Set the fish count on this pond before calculating feed.",
			};
		}

		const fcrReports = await prisma.fcrReport.findMany({
			where: { pondId: input.pondId },
			orderBy: { periodEnd: "asc" },
		});

		const latestFcr = fcrReports.length > 0 ? fcrReports[fcrReports.length - 1].fcrValue : 0;

		const result = calculateFeedRequirement({
			currentWeightKg: input.currentWeightKg,
			targetWeightKg: input.targetWeightKg,
			population,
			days: input.days,
			currentFcr: latestFcr,
			feedsPerDay: input.feedsPerDay ?? undefined,
		});

		return { success: true, ...result, latestFcr };
	} catch (error) {
		console.error("Failed to calculate FCR feed:", error);
		return { success: false, error: "Failed to calculate feed requirement" };
	}
}
