import { LogSampleForm } from "@/components/LogSampleForm";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";

export const revalidate = 0; // Ensure data is fresh

export default async function LogSamplePage() {
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
					Log Biomass Sample
				</h1>
				<p className="text-gray-500 mt-2 text-lg">
					Record new biomass samples for{" "}
					<span className="font-semibold text-gray-700">{pond.name}</span>. This helps calibrate the
					auto-feeder and track FCR.
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
