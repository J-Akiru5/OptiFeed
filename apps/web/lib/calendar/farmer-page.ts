import { resolveMemberOrgScope } from "@/lib/auth/org-scope";
import { hasPermission } from "@/lib/auth/permissions";
import { canWrite, getCurrentPondOwnerId } from "@/lib/auth/session";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { serialiseCycle } from "@/lib/crop-cycle/serialise";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { parsePondProfile } from "@/lib/pond-profile";
import { getActivePondId } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";

/**
 * Data for the farmer's dedicated Calendar page (E25, #212).
 *
 * The page is org-wide: every active pond in the caller's organizations is
 * visible, but only the caller's own farm is writable. The API enforces the
 * same split (`scope=member-org`), so the editor cannot be used to write past
 * the farm even if the client is manipulated.
 */
const CYCLE_SELECT = {
	id: true,
	pondId: true,
	label: true,
	status: true,
	stockingDate: true,
	stockingCount: true,
	stockingAvgWeightG: true,
	growOutDays: true,
	targetHarvestDate: true,
	targetHarvestWeightG: true,
	expectedSurvivalPct: true,
	actualHarvestDate: true,
	actualHarvestWeightKg: true,
	actualHarvestCount: true,
	actualFcr: true,
	notes: true,
};

export interface FarmerCalendarPageData {
	initialPondId: string;
	initialPondName: string;
	initialPondIsFallow: boolean;
	ponds: PondOption[];
	activeCycle: CropCycleDto | null;
	activeCycles: CropCycleDto[];
	recentCycles: CropCycleDto[];
	/** Ponds the caller may edit; org-wide events outside it are read-only. */
	writablePondIds: string[];
	canManage: boolean;
	today: string;
}

export async function loadFarmerCalendarPageData(): Promise<FarmerCalendarPageData | null> {
	const ownerId = await getCurrentPondOwnerId();
	const [memberScope, canWriteNow, canManageEvents, selectedPondId] = await Promise.all([
		resolveMemberOrgScope(),
		canWrite(),
		hasPermission("manage_crop_cycle"),
		getActivePondId(),
	]);

	const memberPondIds = memberScope.pondIds.length > 0 ? memberScope.pondIds : null;
	const ponds = await prisma.pond.findMany({
		where: memberPondIds
			? { id: { in: memberPondIds }, status: "ACTIVE" }
			: { ownerId, status: "ACTIVE" },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			name: true,
			isFallow: true,
			population: true,
			notificationPrefs: true,
			ownerId: true,
		},
	});
	if (ponds.length === 0) return null;

	const writablePondIds = ponds.filter((pond) => pond.ownerId === ownerId).map((pond) => pond.id);
	const initialPond =
		ponds.find((pond) => pond.id === selectedPondId) ??
		ponds.find((pond) => pond.ownerId === ownerId) ??
		ponds[0];

	const cycles = await prisma.cropCycle.findMany({
		where: { pondId: { in: ponds.map((pond) => pond.id) } },
		orderBy: { createdAt: "desc" },
		take: 100,
		select: CYCLE_SELECT,
	});
	const serialised = cycles.map(serialiseCycle);
	const activeCycles = serialised.filter((cycle) => cycle.status === "ACTIVE");
	const pondOptions: PondOption[] = ponds.map((pond) => {
		const profile = parsePondProfile(pond.notificationPrefs);
		return {
			id: pond.id,
			name: pond.name,
			isFallow: pond.isFallow,
			population: pond.population,
			areaM2: profile.areaM2,
			averageDepthM: profile.averageDepthM,
		};
	});

	return {
		initialPondId: initialPond.id,
		initialPondName: initialPond.name,
		initialPondIsFallow: initialPond.isFallow,
		ponds: pondOptions,
		activeCycle: activeCycles.find((cycle) => cycle.pondId === initialPond.id) ?? null,
		activeCycles,
		recentCycles: serialised.filter((cycle) => cycle.status !== "ACTIVE"),
		writablePondIds,
		canManage: canWriteNow && canManageEvents,
		today: todayDateOnly(),
	};
}
