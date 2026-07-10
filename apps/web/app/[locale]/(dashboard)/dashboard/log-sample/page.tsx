import { LogSampleForm } from "@/components/LogSampleForm";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export const revalidate = 0; // Ensure data is fresh

export default async function LogSamplePage() {
	const t = await getTranslations("dashboard.logSample");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found. Please run the seed script.</p>
			</div>
		);
	}

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
					feedingRatePct={pond.feedingRatePct}
					feedsPerDay={pond.feedsPerDay}
				/>
			</div>
		</div>
	);
}
