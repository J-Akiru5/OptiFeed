import { listAllPonds } from "@/lib/actions/superadmin";
import { Eye, Lock } from "lucide-react";

const statusBadge: Record<string, string> = {
	ACTIVE: "bg-green-50 text-[#1E7B34] border-green-200",
	MAINTENANCE: "bg-amber-50 text-amber-700 border-amber-200",
	ARCHIVED: "bg-gray-100 text-[#3D5568] border-gray-200",
};

/**
 * Read-only pond inventory across every tenant.
 *
 * Deliberately renders no edit, schedule, device, or status controls: the
 * platform console observes farmer work but never interferes with it.
 */
export default async function SuperadminPondsPage() {
	const ponds = await listAllPonds();

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-black text-[#0A3D62]">Ponds</h1>
					<p className="text-sm text-[#3D5568] mt-1">
						{ponds.length} pond{ponds.length !== 1 ? "s" : ""} across every tenant
					</p>
				</div>
				<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F4F7F6] border border-gray-200 text-[10px] font-black uppercase tracking-wider text-[#3D5568]">
					<Lock className="w-3 h-3" />
					Read-only
				</span>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["Pond", "Owner", "Organizations", "Status"].map((h) => (
									<th
										key={h}
										className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider"
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{ponds.map((pond) => (
								<tr
									key={pond.id}
									className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
								>
									<td className="px-6 py-4">
										<p className="font-black text-[#0A3D62]">{pond.name}</p>
									</td>
									<td className="px-6 py-4">
										<p className="font-bold text-[#0A3D62]">{pond.ownerName ?? "(unknown)"}</p>
										<p className="text-[11px] font-mono text-[#3D5568]">{pond.ownerFarmId}</p>
									</td>
									<td className="px-6 py-4">
										{pond.orgs.length === 0 ? (
											<span className="text-[11px] italic text-[#3D5568]">—</span>
										) : (
											<div className="flex flex-wrap gap-1.5">
												{pond.orgs.map((name) => (
													<span
														key={name}
														className="inline-flex px-2 py-0.5 rounded-lg bg-[#F4F7F6] border border-gray-200 text-[10px] font-bold text-[#0A3D62]"
													>
														{name}
													</span>
												))}
											</div>
										)}
									</td>
									<td className="px-6 py-4">
										<span
											className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusBadge[pond.status] ?? "bg-gray-100 text-[#3D5568] border-gray-200"}`}
										>
											<Eye className="w-3 h-3" />
											{pond.status}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{ponds.length === 0 && <p className="p-6 text-sm text-[#3D5568]">No ponds registered.</p>}
			</div>

			<p className="text-[11px] text-[#3D5568]">
				Pond edits, scheduling and device controls live in the tenant's own admin console.
			</p>
		</div>
	);
}
