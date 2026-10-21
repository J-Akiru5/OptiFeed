import { BiomassLogTable } from "@/components/BiomassLogTable";
import { Link } from "@/i18n/routing";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function BiomassHistoryPage() {
	const t = await getTranslations("dashboard.growth");
	const tSch = await getTranslations("dashboard.schedule");
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{tSch("noPondData")}</p>
			</div>
		);
	}

	const biomassLogs = await prisma.biomassLog.findMany({
		where: { pondId: pond.id },
		orderBy: { recordedAt: "asc" },
		include: { fishSamples: true },
	});

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500 max-w-5xl mx-auto">
			<div>
				<Link
					href="/dashboard/growth"
					className="inline-flex items-center gap-1 text-sm font-bold text-[#3D5568] dark:text-gray-400 hover:text-[#0A3D62] dark:hover:text-[#5b9bd5] transition-colors mb-2"
				>
					<ChevronLeft className="h-4 w-4" />
					{t("title")}
				</Link>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("historyTitle")}
				</h1>
				<p className="text-gray-500 dark:text-gray-400 mt-1">{t("desc", { pond: pond.name })}</p>
			</div>

			<BiomassLogTable
				logs={biomassLogs.map((log) => ({
					id: log.id,
					recordedAt: log.recordedAt,
					sampleWeightKg: log.sampleWeightKg,
					sampleLengthCm: log.sampleLengthCm,
					sampleCount: log.sampleCount,
					avgWeightKg: log.avgWeightKg,
					batchLabel: log.batchLabel,
					source: log.source,
					fishSamples: log.fishSamples.map((fs) => ({
						id: fs.id,
						weightGrams: fs.weightGrams,
						lengthCm: fs.lengthCm,
					})),
				}))}
			/>
		</div>
	);
}
