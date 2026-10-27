import { adminButtonPrimary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { Link } from "@/i18n/routing";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { todayDateOnly } from "@/lib/crop-cycle/dates";
import { serialiseCycle } from "@/lib/crop-cycle/serialise";
import type { PondOption } from "@/lib/crop-cycle/types";
import { parsePondProfile } from "@/lib/pond-profile";
import prisma from "@/lib/prisma";
import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";

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
	const [scope, t] = await Promise.all([
		resolveOrgScope(),
		getTranslations("dashboard.adminCalendar"),
	]);

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
			<div className="mx-auto w-full max-w-2xl space-y-6">
				<AdminPageHeader icon={CalendarDays} title={t("title")} />
				<AdminEmptyState
					icon={CalendarDays}
					title={t("emptyTitle")}
					description={t("emptyDesc")}
					action={
						<Link href="/admin/ponds/new" className={adminButtonPrimary}>
							{t("emptyAction")}
						</Link>
					}
				/>
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
		<div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 pb-20 [contain:inline-size] animate-in fade-in duration-150">
			<AdminPageHeader
				icon={CalendarDays}
				title={t("title")}
				description={t("desc", { count: ponds.length })}
			/>

			<p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
				{t("readOnly")}
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
