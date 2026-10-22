import { stableSessionId } from "@/lib/ai";
import { ok } from "@/lib/api/envelope";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { DEFAULT_FISH_COUNT, LEGACY_API_SUNSET } from "@/lib/constants";
import { type PredictionInputs, predictFeeding } from "@/lib/prediction";
import prisma from "@/lib/prisma";
import { checkPredictionRateLimit } from "@/lib/rate-limit";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";

export const dynamic = "force-dynamic";

export const POST = withApi(
	withAuth(async (_request, { ownerId }) => {
		const { success } = await checkPredictionRateLimit(ownerId);
		if (!success) {
			return Response.json({ error: "Too Many Requests" }, { status: 429 });
		}

		const pond = await prisma.pond.findFirst({
			where: { ownerId, status: "ACTIVE" },
		});
		if (!pond) {
			return Response.json({ error: "No active pond" }, { status: 404 });
		}

		const [energyDevice, latestBiomass, latestFcr] = await Promise.all([
			prisma.energyDevice.findFirst({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				select: { id: true, gramsPerFeeding: true, hopperCapacityG: true },
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
		]);

		const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);

		const inputs: PredictionInputs = {
			feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
			feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
			population: pond.population ?? DEFAULT_FISH_COUNT,
			avgWeightKg: latestBiomass?.avgWeightKg ?? null,
			latestFcr: latestFcr?.fcrValue ?? null,
			currentGrams: energyDevice?.gramsPerFeeding ?? null,
			hopperCapacityG: energyDevice?.hopperCapacityG ?? null,
			lastSampleAt: latestBiomass?.recordedAt ?? null,
		};

		const prediction = await predictFeeding(
			inputs,
			new Date(),
			stableSessionId("prediction", ownerId, pond.id, new Date().toISOString().slice(0, 10)),
		);

		return ok({
			grams: prediction.grams,
			baselineGrams: prediction.baselineGrams,
			currentGrams: prediction.currentGrams,
			confidence: prediction.confidence,
			reasoning: prediction.reasoning,
			source: prediction.source,
		});
	}),
	{ route: "POST /api/predict-feeding", sunset: LEGACY_API_SUNSET },
);
