import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { serialiseCycle } from "@/lib/crop-cycle/serialise";
import type { PondOption } from "@/lib/crop-cycle/types";
import { parsePondProfile } from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import { CalendarDays } from "lucide-react";

export const revalidate = 0;

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

export default async function AdminCalendarPage() {
	await requireTenantAdmin();
	const scope = await resolveOrgScope();

	const ponds =
		scope.pondIds.length > 0
			? await prisma.pond.findMany({
					where: { id: { in: scope.pondIds }, status: "ACTIVE" },
					orderBy: { createdAt: "asc" },
					select: {
						id: true,
						name: true,
						isFallow: true,
						population: true,
						notificationPrefs: true,
					},
				})
			: [];

	const cycles =
		ponds.length > 0
			? await prisma.cropCycle.findMany({
					where: { pondId: { in: ponds.map((pond) => pond.id) } },
					orderBy: { createdAt: "desc" },
					take: 30,
					select: CYCLE_SELECT,
				})
			: [];

	if (ponds.length === 0) {
		return (
			<div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center rounded-3xl border border-dashed border-[#0A3D62]/20 bg-white p-8 text-center dark:border-white/10 dark:bg-gray-900">
				<div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
					<CalendarDays className="h-7 w-7" />
				</div>
				<h1 className="mt-3 text-xl font-black text-gray-900 dark:text-gray-100">
					No ponds in this organization yet
				</h1>
				<p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
					The calendar shows harvest, sampling, feeding and device events for every pond in your
					organization. Add a pond first, or ask a platform administrator to assign one.
				</p>
			</div>
		);
	}

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
	const serialised = cycles.map(serialiseCycle);
	const activeCycles = serialised.filter((cycle) => cycle.status === "ACTIVE");
	const activeCycle = activeCycles.find((cycle) => cycle.pondId === ponds[0].id) ?? null;
	const recentCycles = serialised.filter((cycle) => cycle.status !== "ACTIVE");

	return (
		<div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 pb-20 animate-in fade-in duration-150 [contain:inline-size]">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="flex items-center gap-2">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
						<CalendarDays className="h-6 w-6" />
					</div>
					<div className="min-w-0">
						<h1 className="text-2xl font-black tracking-tight text-[var(--ofd-base-deep)] sm:text-3xl">
							Farm calendar
						</h1>
						<p className="text-sm text-gray-500 dark:text-gray-400">
							All {ponds.length} active pond{ponds.length === 1 ? "" : "s"} in your organization
						</p>
					</div>
				</div>
			</div>

			<p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300">
				Read-only overview. Open a pond&apos;s Harvest page to start, edit or harvest a cycle.
			</p>

			<HarvestCalendar
				initialPondId={ponds[0].id}
				initialPondName={ponds[0].name}
				initialPondIsFallow={ponds[0].isFallow}
				initialAllPonds
				apiScope="org"
				ponds={pondOptions}
				activeCycle={activeCycle}
				activeCycles={activeCycles}
				recentCycles={recentCycles}
				canManage={false}
				today={todayDateOnly()}
			/>
		</div>
	);
}
