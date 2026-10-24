import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { hasPermission } from "@/lib/auth/permissions";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { serialiseCycle } from "@/lib/crop-cycle/serialise";
import type { PondOption } from "@/lib/crop-cycle/types";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

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
	const recentCycles = serialised.filter((cycle) => cycle.status !== "ACTIVE");

	return (
		<div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 pb-20 animate-in fade-in duration-150 [contain:inline-size]">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="flex items-center gap-2">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]">
							<CalendarDays className="h-6 w-6" />
						</div>
						<div className="min-w-0">
							<h1 className="text-2xl font-black tracking-tight text-[var(--ofd-base-deep)] sm:text-3xl">
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
