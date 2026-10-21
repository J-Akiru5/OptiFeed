import { FeedLevelLogTable } from "@/components/FeedLevelLogTable";
import { Link } from "@/i18n/routing";
import { getFeedLevelLogs } from "@/lib/actions/growth";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function FeedLevelHistoryPage() {
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

	const energyDevice = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
		select: { id: true },
	});

	const page = energyDevice
		? await getFeedLevelLogs({ deviceId: energyDevice.id, cursor: null })
		: null;

	return (
		<div className="space-y-6 pb-20 animate-in fade-in duration-500 max-w-4xl mx-auto">
			<div>
				<Link
					href="/dashboard/growth"
					className="inline-flex items-center gap-1 text-sm font-bold text-[#3D5568] dark:text-gray-400 hover:text-[#0A3D62] dark:hover:text-[#5b9bd5] transition-colors mb-2"
				>
					<ChevronLeft className="h-4 w-4" />
					{t("title")}
				</Link>
				<h1 className="text-3xl font-extrabold tracking-tight text-[var(--ofd-base-deep)]">
					{t("feedLevelTableTitle")}
				</h1>
				<p className="text-gray-500 dark:text-gray-400 mt-1">{t("feedLevelDesc")}</p>
			</div>

			{energyDevice && page ? (
				<div className="bg-white rounded-3xl shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-700/60 overflow-hidden">
					<div className="p-6 border-b border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/60">
						<h3 className="font-bold text-gray-800 dark:text-gray-100">
							{t("feedLevelTableTitle")}
						</h3>
					</div>
					<FeedLevelLogTable
						deviceId={energyDevice.id}
						initialItems={page.items}
						initialHasMore={page.hasMore}
						initialNextCursor={page.nextCursor}
					/>
				</div>
			) : (
				<p className="rounded-3xl bg-white border border-gray-100 dark:bg-gray-900 dark:border-gray-700/60 shadow-sm p-6 text-sm text-gray-500 dark:text-gray-400">
					{t("noFeedLevel")}
				</p>
			)}
		</div>
	);
}
