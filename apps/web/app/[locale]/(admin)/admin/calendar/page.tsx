import { adminButtonPrimary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CalendarCapabilityBadge } from "@/components/harvest/calendar-controls";
import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import { Link } from "@/i18n/routing";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { hasPermission } from "@/lib/auth/permissions";
import { canWrite } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { calendarCapability } from "@/lib/calendar/capability";
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
	const [scope, t, tCommon, canEditEvents, canManageEvents] = await Promise.all([
		resolveOrgScope(),
		getTranslations("dashboard.adminCalendar"),
		getTranslations("dashboard.common"),
		canWrite(),
		hasPermission("manage_crop_cycle"),
	]);
	const canManage = canEditEvents && canManageEvents;

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

	const pondIds = ponds.map((pond) => pond.id);
	// Two bounded reads instead of one page of 30 mixed cycles: an ACTIVE cycle
	// on an older pond used to fall out of the newest-30 window entirely, so the
	// "All ponds" view lost its cycle data. Crop-cycle creation enforces one
	// ACTIVE cycle per pond, so `pondIds.length` is the exact bound for the
	// active read — no silent cut — while history keeps its own 30-row cap.
	const [activeCycleRows, recentCycleRows] =
		pondIds.length > 0
			? await Promise.all([
					prisma.cropCycle.findMany({
						where: { pondId: { in: pondIds }, status: "ACTIVE" },
						orderBy: { createdAt: "desc" },
						take: pondIds.length,
						select: CYCLE_SELECT,
					}),
					prisma.cropCycle.findMany({
						where: { pondId: { in: pondIds }, status: { not: "ACTIVE" } },
						orderBy: { createdAt: "desc" },
						take: 30,
						select: CYCLE_SELECT,
					}),
				])
			: [[], []];

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
	const activeCycles = activeCycleRows.map(serialiseCycle);
	const activeCycle = activeCycles.find((cycle) => cycle.pondId === ponds[0].id) ?? null;
	const recentCycles = recentCycleRows.map(serialiseCycle);

	return (
		<div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 pb-20 [contain:inline-size] animate-in fade-in duration-150">
			<AdminPageHeader
				icon={CalendarDays}
				title={t("title")}
				description={t("desc", { count: ponds.length })}
				actions={
					<CalendarCapabilityBadge
						capability={calendarCapability({ canManage, pondCount: ponds.length })}
						labels={{
							edit: tCommon("capability.edit"),
							ownFarm: tCommon("capability.ownFarm"),
							read: tCommon("capability.read"),
						}}
					/>
				}
			>
				<p className="mt-1 text-xs font-medium text-[#3D5568] dark:text-gray-400">
					{t("editHint")}
				</p>
			</AdminPageHeader>

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
				canManage={canManage}
				canManageCycles={false}
				showHeader={false}
				today={todayDateOnly()}
			/>
		</div>
	);
}
