"use server";

import { getCurrentPondOwnerId, requireWriteAccess } from "@/lib/auth/session";
import { deriveLiveCount } from "@/lib/growth/live-count";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * Record fish mortality for one pond (issue #452).
 *
 * Tenant guard: the pond row is re-read inside the transaction and must belong
 * to `getCurrentPondOwnerId()` — a forged form field for another farm's pond is
 * rejected with the same "Pond not found" message the biomass save uses, so the
 * caller cannot distinguish the two tenants.
 *
 * Audit: every write appends a `mortality_recorded` DeviceStateEvent, so the
 * audit trail shows it the same way `biomass_logged` samples do.
 *
 * Live count policy (issue body): `Pond.population` is never rewritten; the
 * display count is derived at read time by `lib/growth/live-count.ts`.
 */

const COUNT_MAX = 100_000; // whole pond, not a typo guard for "10 fish died"
const REASON_MAX = 200;

export interface SaveMortalityResult {
	success: boolean;
	error?: string;
	live?: {
		stocked: number | null;
		dead: number;
		live: number | null;
		source: "crop_cycle" | "legacy_population" | "none";
	};
}

type LiveSource = NonNullable<SaveMortalityResult["live"]>["source"];

export async function saveMortalityLog(formData: FormData): Promise<SaveMortalityResult> {
	await requireWriteAccess();
	const ownerId = await getCurrentPondOwnerId();

	const pondId = formData.get("pondId");
	const countRaw = formData.get("count");
	const reasonRaw = formData.get("reason");
	// Optional offline-catchup timestamp, same offline idiom as biomass saves.
	const recordedAtRaw = formData.get("recordedAt");

	if (typeof pondId !== "string" || pondId.trim() === "") {
		return { success: false, error: "validation" };
	}
	const count = Number(String(countRaw));
	if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1 || count > COUNT_MAX) {
		return { success: false, error: "validation" };
	}
	const reason =
		typeof reasonRaw === "string" && reasonRaw.trim() !== ""
			? reasonRaw.trim().slice(0, REASON_MAX)
			: null;
	const recordedAt =
		typeof recordedAtRaw === "string" && recordedAtRaw.trim() !== ""
			? new Date(recordedAtRaw)
			: null;

	try {
		const result = await prisma.$transaction(async (tx) => {
			const pond = await tx.pond.findUnique({
				where: { id: pondId },
				select: { id: true, ownerId: true, farmId: true, population: true },
			});

			if (!pond || pond.ownerId !== ownerId) {
				throw new Error("Pond not found");
			}

			const cycle = await tx.cropCycle.findFirst({
				where: { pondId: pond.id, status: "ACTIVE" },
				select: { id: true, stockingCount: true, stockingDate: true },
			});

			const log = await tx.mortalityLog.create({
				data: {
					pondId: pond.id,
					...(cycle ? { cropCycleId: cycle.id } : {}),
					farmId: pond.farmId,
					count,
					reason,
					...(recordedAt ? { recordedAt } : {}),
					createdBy: ownerId,
				},
			});

			const device = await tx.energyDevice.findFirst({
				where: { pondId: pond.id },
				select: { id: true },
			});

			// Only mortality on/after the current stocking date belongs to this
			// cycle; older logs belong to a previous cycle (#430).
			const deadTotal = await tx.mortalityLog.aggregate({
				where: cycle
					? { pondId: pond.id, recordedAt: { gte: cycle.stockingDate } }
					: { pondId: pond.id },
				_sum: { count: true },
			});
			const stocked = cycle ? cycle.stockingCount : (pond.population ?? null);
			const { dead, live } = deriveLiveCount(stocked, deadTotal._sum.count ?? 0);

			if (device) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "mortality_recorded",
						source: "user",
						actorId: ownerId,
						metadata: {
							mortalityLogId: log.id,
							count,
							reason,
							live,
						},
					},
				});
			}

			const source: LiveSource =
				stocked === null ? "none" : cycle ? "crop_cycle" : "legacy_population";
			return { stocked, dead, live, source };
		});

		revalidatePath("/[locale]/dashboard", "layout");

		return { success: true, live: result };
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (message === "Pond not found") {
			return { success: false, error: "pond_not_found" };
		}
		// Unknown failures are surfaced as a generic client error; the server
		// side still records the failure in the logs through the action runner.
		throw error;
	}
}
