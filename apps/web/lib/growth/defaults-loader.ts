import { formatDateOnly } from "@/lib/crop-cycle/dates";
import prisma from "@/lib/prisma";
import {
	type OrgSettingsContext,
	getOrgSettingsForFarms,
	growthDefaultsFromOrgRow,
} from "@/lib/settings/org";
import {
	type GrowthDefaults,
	type ResolvedGrowthDefaults,
	resolveGrowthDefaults,
	sanitizeGrowthDefaults,
} from "./defaults";
import {
	type CompletedCycleForSuggestion,
	type GrowthHistorySuggestion,
	buildGrowthHistorySuggestions,
} from "./history";

/**
 * Server-side reader for the growth-default resolution chain (#828).
 *
 * Scope is derived from `Pond.ownerId` (the farm slug) exactly like every
 * other tenant read:
 *
 *   Pond.ownerId → User.farmId → active Membership → ACTIVE Organization
 *
 * A farm with no resolvable organization has no farm default, so the
 * documented constant applies. The same map is used by the farmer calendar
 * and the admin calendar, so both dialogs show identical values for a pond.
 *
 * History suggestions are computed from the **farm's** completed cycles
 * (`CropCycle.farmId`, the immutable ownership stamp) and attached to every
 * pond of that farm. A farm with no completed cycle gets an empty array, which
 * is how the dialog knows to show no suggestion at all.
 */

export interface PondGrowthDefaultContext {
	/** The organization's stored defaults (nulls mean "not set"). */
	farm: GrowthDefaults;
	/** The pond's stored overrides (nulls mean "inherit"). */
	override: GrowthDefaults;
	/** The value and winning layer for each field. */
	resolved: ResolvedGrowthDefaults;
	/** Evidence-backed suggestions for the next cycle, newest outcome first. */
	suggestions: GrowthHistorySuggestion[];
}

/** One bounded read per farm, regardless of how many ponds are open. */
const HISTORY_PER_FARM_LIMIT = 40;

type CompletedCycleRow = {
	id: string;
	farmId: string | null;
	label: string | null;
	stockingDate: Date;
	stockingCount: number;
	actualHarvestDate: Date | null;
	actualHarvestWeightKg: number | null;
	actualHarvestCount: number | null;
	pond: { name: string };
};

/**
 * One bounded read per farm, so a farm with a long history cannot starve
 * another farm in the same organization out of the sample.
 */
async function readCompletedCycles(farmIds: string[]): Promise<CompletedCycleRow[]> {
	if (farmIds.length === 0) return [];

	const perFarm = await Promise.all(
		farmIds.map((farmId) =>
			Promise.resolve()
				.then(() =>
					prisma.cropCycle.findMany({
						where: {
							farmId,
							status: "HARVESTED",
							actualHarvestDate: { not: null },
							actualHarvestCount: { not: null },
						},
						orderBy: [{ actualHarvestDate: "desc" }, { createdAt: "desc" }],
						take: HISTORY_PER_FARM_LIMIT,
						select: {
							id: true,
							farmId: true,
							label: true,
							stockingDate: true,
							stockingCount: true,
							actualHarvestDate: true,
							actualHarvestWeightKg: true,
							actualHarvestCount: true,
							pond: { select: { name: true } },
						},
					}),
				)
				.catch((error: unknown) => {
					// A history read must not take the calendar/growth page down; no
					// suggestion is the safe outcome (the defaults still apply).
					console.warn("[growth-defaults] history unavailable:", error);
					return [] as CompletedCycleRow[];
				}),
		),
	);

	return perFarm.flat();
}

function suggestionInput(row: CompletedCycleRow): CompletedCycleForSuggestion {
	return {
		id: row.id,
		label: row.label,
		pondName: row.pond?.name ?? "",
		stockingDate: formatDateOnly(row.stockingDate),
		stockingCount: row.stockingCount,
		actualHarvestDate: row.actualHarvestDate ? formatDateOnly(row.actualHarvestDate) : null,
		actualHarvestWeightKg: row.actualHarvestWeightKg,
		actualHarvestCount: row.actualHarvestCount,
	};
}

/**
 * Resolve the defaults for a set of ponds with bounded reads, regardless of how
 * many ponds the caller passes. The caller already owns the pond rows.
 */
export async function loadPondGrowthDefaultContexts(
	ponds: readonly { id: string; ownerId: string; farmId: string }[],
): Promise<Map<string, PondGrowthDefaultContext>> {
	const result = new Map<string, PondGrowthDefaultContext>();
	if (ponds.length === 0) return result;

	const pondIds = [...new Set(ponds.map((pond) => pond.id))];
	const ownerIds = [...new Set(ponds.map((pond) => pond.ownerId))];
	const farmIds = [
		...new Set(
			ponds
				.map((pond) => pond.farmId)
				.filter((farmId): farmId is string => typeof farmId === "string" && farmId.length > 0),
		),
	];

	const settingsByFarm = await getOrgSettingsForFarms(ownerIds).catch((error: unknown) => {
		// A defaults lookup must never take a calendar/growth page down. During
		// a rollout (or in a partial test double) the settings read can fail;
		// the documented constants are a safe, visible fallback.
		console.warn("[growth-defaults] farm defaults unavailable:", error);
		return new Map<string, OrgSettingsContext>();
	});

	const overrideRows = await Promise.resolve()
		.then(() => prisma.pondGrowthOverride.findMany({ where: { pondId: { in: pondIds } } }))
		.catch((error: unknown) => {
			console.warn("[growth-defaults] pond overrides unavailable:", error);
			return [] as Awaited<ReturnType<typeof prisma.pondGrowthOverride.findMany>>;
		});

	const historyRows = await readCompletedCycles(farmIds);
	const historyByFarm = new Map<string, CompletedCycleForSuggestion[]>();
	for (const row of historyRows) {
		if (!row.farmId) continue;
		const bucket = historyByFarm.get(row.farmId) ?? [];
		bucket.push(suggestionInput(row));
		historyByFarm.set(row.farmId, bucket);
	}

	const overrideByPond = new Map(
		overrideRows.map((row) => [row.pondId, sanitizeGrowthDefaults(row)]),
	);

	for (const pond of ponds) {
		const farmSettings = settingsByFarm.get(pond.ownerId)?.settings;
		const farm = growthDefaultsFromOrgRow(farmSettings);
		const override = overrideByPond.get(pond.id) ?? sanitizeGrowthDefaults(null);
		result.set(pond.id, {
			farm,
			override,
			resolved: resolveGrowthDefaults(farm, override),
			suggestions: buildGrowthHistorySuggestions(historyByFarm.get(pond.farmId) ?? []),
		});
	}

	return result;
}

/**
 * One pond's full context for the settings page. Uses the same resilient reads
 * as the calendar/growth loaders, so a missing settings row or a partial test
 * double degrades to the documented constants instead of failing the page.
 */
export async function loadPondGrowthDefaultsForPond(pond: {
	id: string;
	ownerId: string;
	farmId: string;
}): Promise<PondGrowthDefaultContext> {
	const map = await loadPondGrowthDefaultContexts([pond]);
	return (
		map.get(pond.id) ?? {
			farm: sanitizeGrowthDefaults(null),
			override: sanitizeGrowthDefaults(null),
			resolved: resolveGrowthDefaults(null, null),
			suggestions: [],
		}
	);
}
