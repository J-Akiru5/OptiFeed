import { LogSampleForm } from "@/components/LogSampleForm";
import { getCurrentPondOwnerId } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { resolveCurrentSchedule } from "@/lib/schedule/resolve-current";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is fresh

export default async function LogSamplePage() {
	const t = await getTranslations("dashboard.logSample");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: await getCurrentPondOwnerId() },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found. Please run the seed script.</p>
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

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500 max-w-4xl">
			<header className="mb-10">
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("title")}
				</h1>
				<p className="text-gray-500 mt-2 text-lg">
					{t.rich("desc", {
						pond: pond.name,
						bold: (chunks) => <strong className="font-semibold text-gray-700">{chunks}</strong>,
					})}
				</p>
			</header>

			<div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
				<LogSampleForm
					pondId={pond.id}
					feedingRatePct={currentConfig?.feedingRatePct ?? pond.feedingRatePct}
					feedsPerDay={currentConfig?.feedsPerDay ?? pond.feedsPerDay}
				/>
			</div>
		</div>
	);
}
