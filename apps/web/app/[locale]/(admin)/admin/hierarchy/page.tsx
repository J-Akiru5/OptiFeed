import { type HierarchyNode, HierarchyTree } from "@/components/hierarchy-tree";
import { getAllFarmHierarchies } from "@/lib/actions/admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";

export const revalidate = 0;

export default async function AdminHierarchyPage() {
	const hierarchies = await getAllFarmHierarchies();
	const now = Date.now();

	const isOnline = (lastSeenAt: string | null) =>
		!!lastSeenAt && now - Date.parse(lastSeenAt) <= OFFLINE_THRESHOLD_MS;

	const nodes: HierarchyNode[] = hierarchies.map((entry) => ({
		id: `user-${entry.user.id}`,
		kind: "user",
		title: entry.user.displayName || entry.user.email || entry.user.farmId,
		subtitle: `${entry.user.email ?? entry.user.farmId} · ${entry.user.role}`,
		children: entry.farm
			? [
					{
						id: `farm-${entry.farm.id}`,
						kind: "farm" as const,
						title: entry.farm.name,
						subtitle: `Farm ID: ${entry.farm.ownerId}`,
						children: entry.ponds.map((pond) => ({
							id: `pond-${pond.id}`,
							kind: "pond" as const,
							title: pond.name,
							badge:
								pond.status === "ARCHIVED"
									? { text: "Archived", tone: "muted" as const }
									: undefined,
							subtitle: `${pond.devices.length} device${pond.devices.length === 1 ? "" : "s"}`,
							children: pond.devices.map((device) => {
								const online = isOnline(device.lastSeenAt);
								return {
									id: `device-${device.id}`,
									kind: "device" as const,
									title: device.label,
									badge: {
										text: online ? "Online" : "Offline",
										tone: online ? ("green" as const) : ("muted" as const),
									},
								};
							}),
						})),
					},
				]
			: [{ id: `nofarm-${entry.user.id}`, kind: "farm" as const, title: "No farm" }],
	}));

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Farm Hierarchy</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					Every user, their farm, ponds, and devices in one tree.
				</p>
			</div>

			{nodes.length === 0 ? (
				<p className="text-sm font-bold text-[#3D5568]">No users found.</p>
			) : (
				<section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
					<HierarchyTree nodes={nodes} />
				</section>
			)}
		</div>
	);
}
