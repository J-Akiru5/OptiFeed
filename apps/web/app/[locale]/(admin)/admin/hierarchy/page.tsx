import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { type HierarchyNode, HierarchyTree } from "@/components/hierarchy-tree";
import { getAllFarmHierarchies } from "@/lib/actions/admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { FolderTree } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function AdminHierarchyPage() {
	const [hierarchies, t, tCommon] = await Promise.all([
		getAllFarmHierarchies(),
		getTranslations("dashboard.adminHierarchy"),
		getTranslations("dashboard.adminCommon"),
	]);
	const now = Date.now();

	const isOnline = (lastSeenAt: string | null) =>
		!!lastSeenAt && now - Date.parse(lastSeenAt) <= OFFLINE_THRESHOLD_MS;

	const roleLabel = (role: string) =>
		tCommon.has(`roleName.${role}`) ? tCommon(`roleName.${role}`) : role;

	const nodes: HierarchyNode[] = hierarchies.map((entry) => ({
		id: `user-${entry.user.id}`,
		kind: "user",
		title: entry.user.displayName || entry.user.email || entry.user.farmId,
		subtitle: `${entry.user.email ?? entry.user.farmId} · ${roleLabel(
			entry.user.membershipRole ?? entry.user.role,
		)}`,
		children: entry.farm
			? [
					{
						id: `farm-${entry.farm.id}`,
						kind: "farm" as const,
						title: entry.farm.name,
						subtitle: tCommon("farmIdValue", { id: entry.farm.ownerId }),
						children: entry.ponds.map((pond) => ({
							id: `pond-${pond.id}`,
							kind: "pond" as const,
							title: pond.name,
							badge:
								pond.status === "ARCHIVED"
									? { text: tCommon("archived"), tone: "muted" as const }
									: undefined,
							subtitle: t("deviceCount", { count: pond.devices.length }),
							children: pond.devices.map((device) => {
								const online = isOnline(device.lastSeenAt);
								return {
									id: `device-${device.id}`,
									kind: "device" as const,
									title: device.label,
									badge: {
										text: online ? tCommon("online") : tCommon("offline"),
										tone: online ? ("green" as const) : ("muted" as const),
									},
								};
							}),
						})),
					},
				]
			: [{ id: `nofarm-${entry.user.id}`, kind: "farm" as const, title: t("noFarm") }],
	}));

	return (
		<div className="space-y-6">
			<AdminPageHeader icon={FolderTree} title={t("title")} description={t("desc")} />

			{nodes.length === 0 ? (
				<AdminEmptyState icon={FolderTree} title={t("emptyTitle")} description={t("emptyDesc")} />
			) : (
				<section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-700/60 dark:bg-gray-900">
					<HierarchyTree nodes={nodes} />
				</section>
			)}
		</div>
	);
}
