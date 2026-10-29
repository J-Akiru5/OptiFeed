import { ADJUSTMENT_INTERVAL_DAYS, MAX_ADJUSTMENT_PCT } from "@/lib/growth-plan";
import { loadGrowthPlanForPond } from "@/lib/growth-plan-loader";
import { FEEDING_RATE_PCT_MAX, FEEDING_RATE_PCT_MIN, feedGramsSchema } from "@/lib/limits";
import prisma from "@/lib/prisma";
import { calculateNextFeeding } from "@/lib/volumeCalc";
import { revalidatePath } from "next/cache";

/**
 * Deliberately NOT a "use server" module. Every export of a "use server" file
 * is a callable server action, and this function trusts its `ownerId` /
 * `actorId` parameters without any auth check. Keeping it here means only
 * server code (the guarded `applyGrowthPlan` action and the biomass action)
 * can reach it, never a browser.
 */

export interface ApplyGrowthPlanResult {
	success: boolean;
	error?: string;
	previousGrams?: number;
	newGrams?: number;
	appliedAt?: string;
}

const DAY_MS = 86_400_000;

/**
 * Core apply path. Callers must already have checked write access and
 * permission; the biomass action calls this after saving a sample so the
 * target plan, not the generic biomass formula, owns the adjustment.
 */
export async function applyGrowthPlanForPond(params: {
	pondId: string;
	ownerId: string;
	actorId: string;
	grams?: number;
	note?: string;
	initialize?: boolean;
	/** Initialize automatically when this cycle has no prior plan adjustment. */
	initializeIfFirst?: boolean;
}): Promise<ApplyGrowthPlanResult> {
	try {
		const loaded = await loadGrowthPlanForPond(params.pondId, { ownerId: params.ownerId });
		if (!loaded) return { success: false, error: "Pond not found." };
		if (!loaded.deviceId) return { success: false, error: "No feeder is linked to this pond." };
		if (!loaded.cycleId) return { success: false, error: "Start a grow-out cycle first." };

		const plan = loaded.plan;
		const initialize =
			params.initialize === true || (params.initializeIfFirst === true && !plan.hasPriorAdjustment);

		if (initialize) {
			if (plan.hasPriorAdjustment) {
				return {
					success: false,
					error:
						"This cycle already has a feeding adjustment. Use the normal 10% adjustment instead.",
				};
			}
			if (plan.recommendedGramsPerFeeding === null) {
				return { success: false, error: "No starting feeding amount is available yet." };
			}
			if (!plan.device.feasible) {
				return {
					success: false,
					error:
						"This target needs more feed per meal than the feeder supports. Add meals or a second feeder.",
				};
			}
		} else if (!plan.adjustmentAllowed) {
			if (plan.adjustmentBlock === "adjustmentWindow" && plan.nextAdjustmentDate) {
				return {
					success: false,
					error: `The last adjustment was too recent. The next one is available on ${plan.nextAdjustmentDate}.`,
				};
			}
			if (plan.adjustmentBlock === "deviceCap") {
				return {
					success: false,
					error:
						"This target needs more feed per meal than the feeder supports. Add meals or a second feeder.",
				};
			}
			return { success: false, error: "The plan is not ready for an adjustment yet." };
		}

		const requested = initialize
			? plan.recommendedGramsPerFeeding
			: params.grams !== undefined
				? Math.round(params.grams * 10) / 10
				: plan.applicableGramsPerFeeding;
		if (requested === null) {
			return { success: false, error: "No feeding amount is available." };
		}
		if (requested > plan.device.maxGramsPerFeeding) {
			return {
				success: false,
				error: `The feeder limit is ${plan.device.maxGramsPerFeeding.toFixed(1)}g per meal.`,
			};
		}

		const gramsCheck = feedGramsSchema.safeParse(requested);
		if (!gramsCheck.success) {
			return { success: false, error: gramsCheck.error.issues[0]?.message ?? "Invalid amount." };
		}

		const result = await prisma.$transaction(async (tx) => {
			const device = await tx.energyDevice.findFirst({
				where: {
					id: loaded.deviceId as string,
					pondId: params.pondId,
					pond: { ownerId: params.ownerId },
				},
				select: { id: true, gramsPerFeeding: true },
			});
			if (!device) return { kind: "error" as const, message: "Feeder not found." };

			const recent = initialize
				? null
				: await tx.deviceStateEvent.findFirst({
						where: {
							deviceId: device.id,
							eventType: "growth_plan_applied",
							createdAt: {
								gte: new Date(Date.now() - ADJUSTMENT_INTERVAL_DAYS * DAY_MS),
							},
						},
						select: { id: true },
					});
			if (recent) {
				return {
					kind: "error" as const,
					message: `The previous adjustment is still inside the ${ADJUSTMENT_INTERVAL_DAYS}-day window.`,
				};
			}

			if (initialize) {
				const priorEvents = await tx.deviceStateEvent.findMany({
					where: { deviceId: device.id, eventType: "growth_plan_applied" },
					orderBy: { createdAt: "desc" },
					take: 20,
					select: { metadata: true },
				});
				const prior = priorEvents.find((event) => {
					const metadata = event.metadata;
					return (
						metadata !== null &&
						typeof metadata === "object" &&
						!Array.isArray(metadata) &&
						(metadata as Record<string, unknown>).cycleId === loaded.cycleId
					);
				});
				if (prior) {
					return {
						kind: "error" as const,
						message:
							"This cycle already has a feeding adjustment. Use the normal 10% adjustment instead.",
					};
				}
			}

			const previous = device.gramsPerFeeding;
			const currentValid = Number.isFinite(previous) && previous > 0;
			const deviation = currentValid ? Math.abs(requested - previous) / previous : 0;
			if (!initialize && currentValid && deviation > MAX_ADJUSTMENT_PCT + 1e-9) {
				return {
					kind: "error" as const,
					message: `A single adjustment is limited to ${MAX_ADJUSTMENT_PCT * 100}%.`,
				};
			}

			// The rate is the setting; the device dose is derived from it so the
			// website and the feeder cannot diverge (Amendment A-001, D5/D6).
			const pond = await tx.pond.findUnique({
				where: { id: params.pondId },
				select: { feedingRatePct: true, feedsPerDay: true, population: true },
			});
			if (!pond) return { kind: "error" as const, message: "Pond not found." };
			if (!pond.population || pond.population <= 0) {
				return {
					kind: "error" as const,
					message: "Set the pond's fish count before applying a feeding plan.",
				};
			}
			const latestBiomass = await tx.biomassLog.findFirst({
				where: { pondId: params.pondId },
				orderBy: { recordedAt: "desc" },
				select: { avgWeightKg: true },
			});
			if (!latestBiomass) {
				return {
					kind: "error" as const,
					message: "Log a biomass sample before applying a feeding plan.",
				};
			}

			const currentRate = pond.feedingRatePct;
			const proportionalRate =
				initialize || !currentValid ? null : currentRate * (requested / previous);
			const nextRate = Math.min(
				Math.max(
					proportionalRate ?? plan.requiredFeedingRatePct ?? currentRate,
					FEEDING_RATE_PCT_MIN,
				),
				FEEDING_RATE_PCT_MAX,
			);
			const derivedGrams = calculateNextFeeding(
				latestBiomass.avgWeightKg,
				nextRate,
				pond.feedsPerDay,
				pond.population,
			);
			if (derivedGrams === null) {
				return {
					kind: "error" as const,
					message:
						"The feeding plan could not produce a valid dose. Check the fish count and sample.",
				};
			}
			const derivedCheck = feedGramsSchema.safeParse(derivedGrams);
			if (!derivedCheck.success) {
				return {
					kind: "error" as const,
					message: "The feeding plan produced a dose outside the feeder limits.",
				};
			}

			const updated = await tx.energyDevice.updateMany({
				where: { id: device.id, gramsPerFeeding: previous },
				data: { gramsPerFeeding: derivedGrams },
			});
			if (updated.count !== 1) {
				return {
					kind: "error" as const,
					message: "The schedule changed while you were reviewing. Refresh and try again.",
				};
			}

			await tx.pond.update({
				where: { id: params.pondId },
				data: { feedingRatePct: nextRate },
			});

			await tx.deviceStateEvent.create({
				data: {
					deviceId: device.id,
					eventType: "growth_plan_applied",
					source: "user",
					actorId: params.actorId,
					metadata: {
						cycleId: loaded.cycleId,
						targetWeightG: plan.targetWeightG,
						targetDate: plan.targetDate,
						targetSource: plan.targetSource,
						sampleDate: plan.currentSampleDate,
						recommendedGrams: plan.recommendedGramsPerFeeding,
						applicableGrams: plan.applicableGramsPerFeeding,
						gramsRequested: requested,
						gramsApplied: derivedGrams,
						gramsPrevious: previous,
						ratePrevious: currentRate,
						rateApplied: nextRate,
						adjustmentPct: plan.adjustmentPct,
						confidence: plan.confidence,
						fcrAssumption: plan.feed.fcrAssumption,
						initialized: initialize,
						note: params.note ?? null,
					},
				},
			});

			return { kind: "ok" as const, previous, requested: derivedGrams };
		});

		if (result.kind === "error") {
			return { success: false, error: result.message };
		}

		revalidatePath("/[locale]/(dashboard)/dashboard/growth", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard/calendar", "page");
		revalidatePath("/[locale]/(dashboard)/dashboard", "page");
		return {
			success: true,
			previousGrams: result.previous,
			newGrams: result.requested,
			appliedAt: new Date().toISOString(),
		};
	} catch (error) {
		console.error("[growth-plan] apply failed:", error);
		return { success: false, error: "Could not apply the growth plan. Try again." };
	}
}
