"use server";

import {
	assessStoredFcrReport,
	computeFcrForPond,
	storedFcrCoverageForReport,
} from "@/lib/analytics/fcr";
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

/**
 * Feed requirement from a *log-backed* FCR (issue #875).
 *
 * Precedence:
 *  1. the FCR computed from FeedEvent + BiomassLog inside the current window;
 *  2. a stored FcrReport whose own period is covered by those logs and whose
 *     `fcrValue` matches its `totalFeedKg / biomassGainKg`.
 *
 * Anything else is refused. A stored value the logs cannot reproduce is not a
 * measurement, and turning "no verified FCR" into 0 (or into the calculator's
 * 1.5 reference) would size a real feed request from a made-up number.
 */
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

		const { computation } = await computeFcrForPond(input.pondId);
		let latestFcr: number | null =
			computation.fcr !== null && Number.isFinite(computation.fcr) && computation.fcr > 0
				? computation.fcr
				: null;
		let fcrSource: "computed" | "stored" | null = latestFcr === null ? null : "computed";

		if (latestFcr === null) {
			const stored = await prisma.fcrReport.findFirst({
				where: { pondId: input.pondId },
				orderBy: { periodEnd: "desc" },
			});
			if (stored) {
				const coverage = await storedFcrCoverageForReport(input.pondId, stored);
				const assessment = assessStoredFcrReport(stored, coverage);
				if (assessment.verified && Number.isFinite(stored.fcrValue) && stored.fcrValue > 0) {
					latestFcr = stored.fcrValue;
					fcrSource = "stored";
				}
			}
		}

		if (latestFcr === null) {
			return {
				success: false,
				code: "fcr-unverified",
				error:
					"No FCR can be verified for this pond yet. Log feed and at least two biomass samples for the current cycle, then calculate again.",
			};
		}

		const result = calculateFeedRequirement({
			currentWeightKg: input.currentWeightKg,
			targetWeightKg: input.targetWeightKg,
			population,
			days: input.days,
			currentFcr: latestFcr,
			feedsPerDay: input.feedsPerDay ?? undefined,
		});

		return { success: true, ...result, latestFcr, fcrSource };
	} catch (error) {
		console.error("Failed to calculate FCR feed:", error);
		return { success: false, error: "Failed to calculate feed requirement" };
	}
}
