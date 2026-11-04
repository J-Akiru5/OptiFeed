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
 */

export interface PondGrowthDefaultContext {
	/** The organization's stored defaults (nulls mean "not set"). */
	farm: GrowthDefaults;
	/** The pond's stored overrides (nulls mean "inherit"). */
	override: GrowthDefaults;
	/** The value and winning layer for each field. */
	resolved: ResolvedGrowthDefaults;
}

/**
 * Resolve the defaults for a set of ponds with three bounded reads, regardless
 * of how many ponds the caller passes. The caller already owns the pond rows.
 */
export async function loadPondGrowthDefaultContexts(
	ponds: readonly { id: string; ownerId: string }[],
): Promise<Map<string, PondGrowthDefaultContext>> {
	const result = new Map<string, PondGrowthDefaultContext>();
	if (ponds.length === 0) return result;

	const pondIds = [...new Set(ponds.map((pond) => pond.id))];
	const ownerIds = [...new Set(ponds.map((pond) => pond.ownerId))];

	// A defaults lookup must never take a calendar/growth page down. During a
	// rollout (or in a partial test double) the settings/override reads can
	// fail; the documented constants are a safe, visible fallback.
	const settingsByFarm = await getOrgSettingsForFarms(ownerIds).catch((error: unknown) => {
		// A defaults lookup must never take a calendar/growth page down. During a
		// rollout (or in a partial test double) the settings read can fail; the
		// documented constants are a safe, visible fallback.
		console.warn("[growth-defaults] farm defaults unavailable:", error);
		return new Map<string, OrgSettingsContext>();
	});

	const overrideRows = await Promise.resolve()
		.then(() => prisma.pondGrowthOverride.findMany({ where: { pondId: { in: pondIds } } }))
		.catch((error: unknown) => {
			console.warn("[growth-defaults] pond overrides unavailable:", error);
			return [] as Awaited<ReturnType<typeof prisma.pondGrowthOverride.findMany>>;
		});

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
}): Promise<PondGrowthDefaultContext> {
	const map = await loadPondGrowthDefaultContexts([pond]);
	return (
		map.get(pond.id) ?? {
			farm: sanitizeGrowthDefaults(null),
			override: sanitizeGrowthDefaults(null),
			resolved: resolveGrowthDefaults(null, null),
		}
	);
}
