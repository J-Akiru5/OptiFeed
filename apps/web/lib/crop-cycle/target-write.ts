import {
	type GrowthTargetResolution,
	cycleTargetConflict,
	isCycleTargetWeightInRange,
	roundTargetWeightG,
} from "@/lib/growth-target";
import { type PondGrowthTarget, mergePondGrowthTarget } from "@/lib/pond-profile";
import type { Prisma } from "@prisma/client";

/**
 * The one guarded write path for the mirrored harvest target (#318).
 *
 * `CropCycle.targetHarvestWeightG` is a mirror of the calculator target kept in
 * `Pond.notificationPrefs.profile.growthTarget`. Before this module, the cycle
 * form and the calculator each wrote the mirror themselves; any other writer
 * (an import, an assistant action, a bulk edit) could set one store and leave
 * the other stale.
 *
 * Every writer now goes through one of:
 * - `resolveCycleTargetWrite` - the Replace/Keep decision for an edit;
 * - `cycleTargetForCreate` - the range guard for a new cycle;
 * - `writePondGrowthTarget` / `writeCycleTargetMirror` - the only
 *   count-guarded writes of the two stores.
 *
 * A static guard test (`lib/__tests__/crop-cycle-target-writers.test.ts`)
 * fails when a new module writes `targetHarvestWeightG` directly, and
 * `cycleTargetDrift` is the read-only reconciliation check for scripted data.
 */

/** Error codes the actions translate into user-facing messages. */
export const CYCLE_TARGET_ERROR = {
	conflict: "GROWTH_TARGET_CONFLICT",
	savedOutOfRange: "SAVED_TARGET_OUT_OF_RANGE",
	outOfRange: "TARGET_OUT_OF_RANGE",
	noCycle: "NO_CYCLE",
	pondNotFound: "POND_NOT_FOUND",
} as const;

export interface CycleTargetWritePlan {
	/** The value the cycle mirror must end up with. */
	cycleTargetWeightG: number | null;
	/**
	 * What to write into the pond profile: `undefined` leaves it untouched,
	 * `null` removes the saved target, an object replaces it.
	 */
	targetToWrite: PondGrowthTarget | null | undefined;
}

/**
 * Range guard for a cycle that is about to be created.
 *
 * A new cycle has no saved calculator target yet, so there is no conflict to
 * resolve; the only rule is that the field can store the value. Rounding and
 * the ceiling match `cropCycleInputSchema.targetHarvestWeightG`.
 */
export function cycleTargetForCreate(value: number | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const weightG = roundTargetWeightG(value);
	if (!isCycleTargetWeightInRange(weightG)) {
		throw new Error(CYCLE_TARGET_ERROR.outOfRange);
	}
	return weightG;
}

/**
 * Resolve an edit to the cycle target against the saved calculator target.
 *
 * Fails closed: a changed value with no explicit Replace/Keep choice throws
 * `GROWTH_TARGET_CONFLICT`, so a direct or stale caller can never silently
 * pick a side. "Keep" restores the mirror to the calculator value, which is
 * the only reading consistent with one number everywhere.
 */
export function resolveCycleTargetWrite(params: {
	nextWeightG: number | null | undefined;
	cycleWeightG: number | null | undefined;
	savedTarget: PondGrowthTarget | null;
	resolution?: GrowthTargetResolution;
	population: number | null;
	cycleId: string;
	now?: Date;
}): CycleTargetWritePlan {
	const nextWeightG = params.nextWeightG ?? null;

	if (nextWeightG !== null && !isCycleTargetWeightInRange(roundTargetWeightG(nextWeightG))) {
		throw new Error(CYCLE_TARGET_ERROR.outOfRange);
	}

	const conflict = params.savedTarget
		? cycleTargetConflict({
				savedWeightG: params.savedTarget.targetWeightG,
				cycleWeightG: params.cycleWeightG,
				nextWeightG,
			})
		: null;

	// No collision: the mirror is already consistent, or the target field was
	// not edited. The pond profile is deliberately left alone.
	if (!conflict) {
		return { cycleTargetWeightG: nextWeightG, targetToWrite: undefined };
	}

	if (params.resolution === "replace") {
		if (nextWeightG === null) {
			// Replacing with an empty cycle target removes the saved target too;
			// the choice was explicit, not silent.
			return { cycleTargetWeightG: null, targetToWrite: null };
		}
		const weightG = roundTargetWeightG(nextWeightG);
		return {
			cycleTargetWeightG: weightG,
			targetToWrite: {
				targetWeightG: weightG,
				population: params.population,
				cycleId: params.cycleId,
				setAt: (params.now ?? new Date()).toISOString(),
			},
		};
	}

	if (params.resolution === "keep") {
		if (!isCycleTargetWeightInRange(conflict.savedWeightG)) {
			// Keeping an unmovable value would leave two numbers; refuse and let
			// the caller replace or remove it instead.
			throw new Error(CYCLE_TARGET_ERROR.savedOutOfRange);
		}
		return { cycleTargetWeightG: conflict.savedWeightG, targetToWrite: undefined };
	}

	throw new Error(CYCLE_TARGET_ERROR.conflict);
}

/**
 * Write the pond half of the mirror pair. Count-guarded so a foreign or
 * deleted pond is an error, never a silent no-op.
 */
export async function writePondGrowthTarget(
	tx: Prisma.TransactionClient,
	params: {
		pondId: string;
		ownerId: string;
		currentPrefs: unknown;
		target: PondGrowthTarget | null;
	},
): Promise<void> {
	const updated = await tx.pond.updateMany({
		where: { id: params.pondId, ownerId: params.ownerId },
		data: {
			notificationPrefs: mergePondGrowthTarget(
				params.currentPrefs,
				params.target,
			) as unknown as Prisma.InputJsonValue,
		},
	});
	if (updated.count !== 1) throw new Error(CYCLE_TARGET_ERROR.pondNotFound);
}

/**
 * Write the cycle half of the mirror pair.
 *
 * `onMissing: "ignore"` is for the clear path: a harvested or deleted cycle has
 * no active mirror left to clear and its history must stay intact.
 */
export async function writeCycleTargetMirror(
	tx: Prisma.TransactionClient,
	params: {
		cycleId: string;
		pondId: string;
		weightG: number | null;
		onMissing?: "throw" | "ignore";
	},
): Promise<void> {
	const mirrored = await tx.cropCycle.updateMany({
		where: { id: params.cycleId, pondId: params.pondId, status: "ACTIVE" },
		data: { targetHarvestWeightG: params.weightG },
	});
	if (mirrored.count !== 1 && params.onMissing !== "ignore") {
		throw new Error(CYCLE_TARGET_ERROR.noCycle);
	}
}

export interface CycleTargetDrift {
	inSync: boolean;
	savedWeightG: number | null;
	cycleWeightG: number | null;
	/** cycle - saved, rounded to tenths; null when there is no saved target. */
	driftG: number | null;
}

/**
 * Read-only reconciliation check for data written outside the guarded paths
 * (a scripted import or a hand-edited row, issue #318/#319). Reads never write:
 * the caller decides whether to report, repair on the next calculator save, or
 * refuse the row.
 */
export function cycleTargetDrift(params: {
	cycleWeightG: number | null | undefined;
	savedTarget: PondGrowthTarget | null;
}): CycleTargetDrift {
	const cycleWeightG =
		typeof params.cycleWeightG === "number" && Number.isFinite(params.cycleWeightG)
			? params.cycleWeightG
			: null;
	const saved = params.savedTarget;
	if (!saved) {
		return { inSync: true, savedWeightG: null, cycleWeightG, driftG: null };
	}
	const inSync =
		cycleWeightG !== null &&
		roundTargetWeightG(cycleWeightG) === roundTargetWeightG(saved.targetWeightG);
	return {
		inSync,
		savedWeightG: saved.targetWeightG,
		cycleWeightG,
		driftG: roundTargetWeightG((cycleWeightG ?? 0) - saved.targetWeightG),
	};
}
