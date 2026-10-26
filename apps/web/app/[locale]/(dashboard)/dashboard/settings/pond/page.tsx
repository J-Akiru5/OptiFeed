import { LogoutButton } from "@/components/LogoutButton";
import { PondSettingsForm } from "@/components/PondSettingsForm";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { canWrite } from "@/lib/auth/session";
import { parsePondProfile } from "@/lib/pond-profile";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { Settings, SlidersHorizontal, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function PondSettingsPage() {
	const [t, tCommon] = await Promise.all([
		getTranslations("dashboard.settings"),
		getTranslations("dashboard.common"),
	]);
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="mx-auto max-w-4xl py-10">
				<DashboardEmptyState
					icon={Settings}
					title={t("errorLoad")}
					description={t("errorLoadDesc")}
				/>
			</div>
		);
	}

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		select: { id: true },
	});

	// `pond.*` goes stale when a device is paired (saves queue ScheduleCommands);
	// prefer the newest pending/sent command, then the last applied one.
	const currentConfig = await resolveCurrentSchedule(pond.id, energyDevice?.id ?? null);
	const writeAccess = await canWrite();
	const profile = parsePondProfile(pond.notificationPrefs);

	return (
		<div className="mx-auto max-w-4xl space-y-6 pb-20">
			<DashboardPageHeader title={t("pondTitle")} description={t("pondDesc")} icon={Settings} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			<DashboardSection title={t("configTitle")} icon={SlidersHorizontal}>
				<PondSettingsForm
					pond={{
						id: pond.id,
						feedingRatePct: currentConfig?.feedingRatePct ?? pond.feedingRatePct,
						feedsPerDay: currentConfig?.feedsPerDay ?? pond.feedsPerDay,
						sampleIntervalDays: pond.sampleIntervalDays,
						population: pond.population,
						areaM2: profile.areaM2,
						averageDepthM: profile.averageDepthM,
						feedPricePerKg: profile.feedPricePerKg,
					}}
					canWrite={writeAccess}
				/>
			</DashboardSection>

			<DashboardSection title={t("accountTitle")} description={t("accountDesc")} icon={User}>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h3 className="font-bold text-[#0A3D62] dark:text-gray-100">{t("signOutTitle")}</h3>
						<p className="text-sm text-[#3D5568] dark:text-gray-400">{t("signOutDesc")}</p>
					</div>
					<LogoutButton />
				</div>
			</DashboardSection>
		</div>
	);
}
