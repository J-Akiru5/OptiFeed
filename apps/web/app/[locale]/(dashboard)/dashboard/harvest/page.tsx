import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { hasPermission } from "@/lib/auth/permissions";
import { todayDateOnly, utcDateToDateOnly } from "@/lib/crop-cycle/dates";
import type { CropCycleDto, PondOption } from "@/lib/crop-cycle/types";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

function serialiseCycle(cycle: {
	id: string;
	pondId: string;
	label: string | null;
	status: "ACTIVE" | "HARVESTED" | "CANCELLED";
	stockingDate: Date;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	growOutDays: number;
	targetHarvestDate: Date;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
	actualHarvestDate: Date | null;
	actualHarvestWeightKg: number | null;
	actualHarvestCount: number | null;
	actualFcr: number | null;
	notes: string | null;
}): CropCycleDto {
	return {
		id: cycle.id,
		pondId: cycle.pondId,
		label: cycle.label,
		status: cycle.status,
		stockingDate: utcDateToDateOnly(cycle.stockingDate),
		stockingCount: cycle.stockingCount,
		stockingAvgWeightG: cycle.stockingAvgWeightG,
		growOutDays: cycle.growOutDays,
		targetHarvestDate: utcDateToDateOnly(cycle.targetHarvestDate),
		targetHarvestWeightG: cycle.targetHarvestWeightG,
		expectedSurvivalPct: cycle.expectedSurvivalPct,
		actualHarvestDate: cycle.actualHarvestDate ? utcDateToDateOnly(cycle.actualHarvestDate) : null,
		actualHarvestWeightKg: cycle.actualHarvestWeightKg,
		actualHarvestCount: cycle.actualHarvestCount,
		actualFcr: cycle.actualFcr,
		notes: cycle.notes,
	};
}

export default async function HarvestPage() {
	const t = await getTranslations("dashboard.harvest");
	const tSchedule = await getTranslations("dashboard.schedule");
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{tSchedule("noPondData")}</p>
			</div>
		);
	}

	const [canManage, ponds, cycles] = await Promise.all([
		hasPermission("manage_crop_cycle"),
		prisma.pond.findMany({
			where: { ownerId: pond.ownerId, status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
			select: { id: true, name: true, isFallow: true, population: true },
		}),
		prisma.cropCycle.findMany({
			where: { pond: { ownerId: pond.ownerId } },
			orderBy: { createdAt: "desc" },
			take: 30,
			select: {
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
			},
		}),
	]);

	const pondOptions: PondOption[] = ponds.map((item) => ({
		id: item.id,
		name: item.name,
		isFallow: item.isFallow,
		population: item.population,
	}));
	const serialised = cycles.map(serialiseCycle);
	const activeCycles = serialised.filter((cycle) => cycle.status === "ACTIVE");
	const activeCycle = activeCycles.find((cycle) => cycle.pondId === pond.id) ?? null;
	const recentCycles = serialised
		.filter((cycle) => cycle.pondId === pond.id && cycle.status !== "ACTIVE")
		.slice(0, 3);

	return (
		<div className="mx-auto max-w-7xl space-y-6 pb-20 animate-in fade-in duration-500">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
							<CalendarDays className="h-6 w-6" />
						</div>
						<div>
							<h1 className="text-3xl font-black tracking-tight text-[var(--ofd-base-deep)]">
								{t("title")}
							</h1>
							<p className="text-sm text-gray-500 dark:text-gray-400">
								{t("desc", { pond: pond.name })}
							</p>
						</div>
					</div>
				</div>
			</div>

			<HarvestCalendar
				initialPondId={pond.id}
				initialPondName={pond.name}
				initialPondIsFallow={pond.isFallow}
				ponds={pondOptions}
				activeCycle={activeCycle}
				activeCycles={activeCycles}
				recentCycles={recentCycles}
				canManage={canManage}
				today={todayDateOnly()}
			/>
		</div>
	);
}
