import { stableSessionId } from "@/lib/ai";
import { ok } from "@/lib/api/envelope";
import { notFound, rateLimited } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { DEFAULT_FISH_COUNT, LEGACY_API_SUNSET } from "@/lib/constants";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { toPredictionCycleContext } from "@/lib/crop-cycle/prediction-context";
import { getActivePond } from "@/lib/pond-selection";
import { type PredictionInputs, predictFeeding } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { checkPredictionRateLimit } from "@/lib/rate-limit";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export const dynamic = "force-dynamic";

export const POST = withApi(
	withAuth(async (_request, { ownerId }) => {
		const { success } = await checkPredictionRateLimit(ownerId);
		if (!success) {
			throw rateLimited("Too many prediction requests. Wait a minute before refreshing again.", 60);
		}

		// Use the same active pond the Growth page is showing. Picking the
		// first ACTIVE pond here silently predicted the wrong pond for farms
		// with more than one.
		const pond = await getActivePond();
		if (!pond) throw notFound("No active pond.");

		const [energyDevice, latestBiomass, latestFcr, activeCycle] = await Promise.all([
			prisma.energyDevice.findFirst({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				select: { id: true, gramsPerFeeding: true, hopperCapacityG: true, dailyCapG: true },
			}),
			prisma.biomassLog.findFirst({
				where: { pondId: pond.id },
				orderBy: { recordedAt: "desc" },
				select: { avgWeightKg: true, recordedAt: true },
			}),
			prisma.fcrReport.findFirst({
				where: { pondId: pond.id },
				orderBy: { periodEnd: "desc" },
				select: { fcrValue: true },
			}),
			prisma.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: {
					id: true,
					label: true,
					stockingDate: true,
					stockingCount: true,
					growOutDays: true,
					targetHarvestDate: true,
					targetHarvestWeightG: true,
					expectedSurvivalPct: true,
				},
			}),
		]);

		if (!energyDevice) {
			throw notFound("No feeder is paired with this pond.");
		}

		const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice.id);
		const cycle = activeCycle ? toPredictionCycleContext(activeCycle, todayDateOnly()) : null;

		const inputs: PredictionInputs = {
			feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
			feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
			population: pond.population ?? DEFAULT_FISH_COUNT,
			avgWeightKg: latestBiomass?.avgWeightKg ?? null,
			latestFcr: latestFcr?.fcrValue ?? null,
			currentGrams: energyDevice.gramsPerFeeding ?? null,
			hopperCapacityG: energyDevice.hopperCapacityG ?? null,
			dailyCapG: energyDevice.dailyCapG ?? null,
			lastSampleAt: latestBiomass?.recordedAt ?? null,
			isFallow: Boolean(pond.isFallow),
			cycle,
		};

		const prediction = await predictFeeding(
			inputs,
			new Date(),
			stableSessionId("prediction", ownerId, pond.id, new Date().toISOString().slice(0, 10)),
		);

		return ok(
			{
				pondId: pond.id,
				deviceId: energyDevice.id,
				...prediction,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}),
	{
		route: "POST /api/predict-feeding",
		// The provider call is bounded at 8 s in lib/prediction.ts. The route
		// budget must exceed it or a slow-but-valid AI response becomes a 504
		// before the deterministic fallback can be returned.
		timeoutMs: 12_000,
		slowMs: 3_000,
		violationMs: 12_000,
		sunset: LEGACY_API_SUNSET,
	},
);
