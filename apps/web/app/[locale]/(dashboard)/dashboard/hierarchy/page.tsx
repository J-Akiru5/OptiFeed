import { type HierarchyNode, HierarchyTree } from "@/components/hierarchy-tree";
import { getFarmHierarchy } from "@/lib/actions/farm";
import { FolderTree, Sprout } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

export default async function HierarchyPage() {
	const t = await getTranslations("dashboard.hierarchy");
	const data = await getFarmHierarchy();
	const now = Date.now();

	const isOnline = (lastSeenAt: string | null) =>
		!!lastSeenAt && now - Date.parse(lastSeenAt) <= OFFLINE_THRESHOLD_MS;

	const nodes: HierarchyNode[] = data
		? [
				{
					id: `user-${data.user.id}`,
					kind: "user",
					title: data.user.displayName || data.user.email || data.user.farmId,
					subtitle: data.user.email ?? data.user.farmId,
					children: [
						{
							id: `farm-${data.farm.id}`,
							kind: "farm",
							title: data.farm.name,
							subtitle: t("farmId", { id: data.farm.ownerId }),
							children: data.ponds.map((pond) => ({
								id: `pond-${pond.id}`,
								kind: "pond" as const,
								title: pond.name,
								badge:
									pond.status === "ARCHIVED"
										? { text: t("archived"), tone: "muted" as const }
										: undefined,
								subtitle: t("devicesCount", { count: pond.devices.length }),
								children: pond.devices.map((device) => {
									const online = isOnline(device.lastSeenAt);
									return {
										id: `device-${device.id}`,
										kind: "device" as const,
										title: device.label,
										badge: {
											text: online ? t("online") : t("offline"),
											tone: online ? ("green" as const) : ("muted" as const),
										},
									};
								}),
							})),
						},
					],
				},
			]
		: [];

	return (
		<div className="mx-auto max-w-4xl space-y-6">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<FolderTree size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			{data ? (
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<HierarchyTree nodes={nodes} />
				</section>
			) : (
				<section className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
					<Sprout className="mx-auto h-12 w-12 text-gray-300" aria-hidden />
					<p className="mt-4 font-bold text-gray-600">{t("noFarm")}</p>
				</section>
			)}
		</div>
	);
}
