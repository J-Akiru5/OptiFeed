"use server";

import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { revalidatePath } from "next/cache";

const DEVIATION_THRESHOLD = 0.5; // 50% — reject if new value differs this much from current

export async function saveBiomassLog(formData: FormData) {
	const pondId = formData.get("pondId") as string;
	const sampleWeightKg = Number.parseFloat(formData.get("sampleWeightKg") as string);
	const sampleLengthCm = Number.parseFloat(formData.get("sampleLengthCm") as string);
	const sampleCount = Number.parseInt(formData.get("sampleCount") as string, 10);

	if (
		!pondId ||
		Number.isNaN(sampleWeightKg) ||
		Number.isNaN(sampleLengthCm) ||
		Number.isNaN(sampleCount) ||
		sampleCount <= 0
	) {
		throw new Error("Invalid form data");
	}

	const avgWeightKg = sampleWeightKg / sampleCount;

	const biomassLog = await prisma.$transaction(async (tx) => {
		const log = await tx.biomassLog.create({
			data: {
				pondId,
				sampleWeightKg,
				sampleLengthCm,
				sampleCount,
				avgWeightKg,
			},
		});

		const pond = await tx.pond.findUnique({
			where: { id: pondId },
			select: { feedingRatePct: true, feedsPerDay: true },
		});

		if (!pond || pond.feedingRatePct <= 0 || pond.feedsPerDay <= 0) {
			console.log(
				`[biomass] skipped device update: pond config incomplete (feedingRatePct=${pond?.feedingRatePct}, feedsPerDay=${pond?.feedsPerDay})`,
			);
			return log;
		}

		const energyDevice = await tx.energyDevice.findFirst({
			where: { pondId },
		});

		if (!energyDevice) {
			console.log("[biomass] skipped device update: no linked EnergyDevice");
			return log;
		}

		const newGrams = calculateNextFeeding(avgWeightKg, pond.feedingRatePct, pond.feedsPerDay);
		const currentGrams = energyDevice.gramsPerFeeding;
		const deviation = Math.abs(newGrams - currentGrams) / currentGrams;

		if (deviation > DEVIATION_THRESHOLD) {
			console.warn(
				`[biomass] rejected auto-adjust: ${currentGrams}g → ${newGrams}g (${(deviation * 100).toFixed(1)}% deviation, threshold ${DEVIATION_THRESHOLD * 100}%) — biomassLogId=${log.id}`,
			);
			return log;
		}

		await tx.energyDevice.update({
			where: { id: energyDevice.id },
			data: { gramsPerFeeding: newGrams },
		});

		console.log(
			`[biomass] gramsPerFeeding: ${currentGrams}g → ${newGrams}g (biomassLogId=${log.id})`,
		);

		return log;
	});

	revalidatePath("/[locale]/dashboard", "layout");

	return biomassLog;
}
