import { cache } from "react";

import { type LiveFishCount, resolveLiveFish } from "@/lib/population";
import prisma from "@/lib/prisma";

/**
 * The database half of the live-fish resolver (see `lib/population.ts` for the
 * formula). Server-only: it reads the active grow-out cycle, which is the
 * authoritative stocking count, and falls back to `Pond.population`.
 *
 * Wrapped in React `cache` so the dashboard, the prediction action and the
 * device-gram sync read it once per request.
 */

export interface PondPopulation extends LiveFishCount {
	pondId: string;
	/** `Pond.population` — may lag the active cycle's stocking count. */
	pondPopulation: number | null;
	cycleId: string | null;
}

export const getPondPopulation = cache(async (pondId: string): Promise<PondPopulation> => {
	const [pond, cycle] = await Promise.all([
		prisma.pond.findUnique({
			where: { id: pondId },
			select: { population: true },
		}),
		prisma.cropCycle.findFirst({
			where: { pondId, status: "ACTIVE" },
			select: { id: true, stockingCount: true, expectedSurvivalPct: true },
		}),
	]);

	const live = resolveLiveFish({
		stockedCount: cycle?.stockingCount ?? pond?.population ?? null,
		expectedSurvivalPct: cycle?.expectedSurvivalPct ?? null,
	});

	return {
		...live,
		pondId,
		pondPopulation: pond?.population ?? null,
		cycleId: cycle?.id ?? null,
	};
});
