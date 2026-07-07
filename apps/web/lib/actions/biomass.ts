"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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

	await prisma.biomassLog.create({
		data: {
			pondId,
			sampleWeightKg,
			sampleLengthCm,
			sampleCount,
			avgWeightKg,
		},
	});

	revalidatePath("/[locale]/dashboard", "layout");
}
