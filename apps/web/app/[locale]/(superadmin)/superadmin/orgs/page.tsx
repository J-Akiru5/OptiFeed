import { CreateOrgForm } from "@/components/superadmin/create-org-form";
import { listOrgs } from "@/lib/actions/superadmin";
import { FolderTree } from "lucide-react";

const typeBadge: Record<string, string> = {
	INDIVIDUAL: "bg-gray-200 text-[#3D5568]",
	COOPERATIVE: "bg-[#0A3D62] text-white",
	COMPANY: "bg-[#0A3D62] text-white",
	LGU: "bg-[#E85A2A] text-white",
	ACADEMIC: "bg-[#E85A2A] text-white",
};

export default async function SuperadminOrgsPage() {
	const orgs = await listOrgs();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Organizations</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					Tenants. Memberships define what each account can see in the admin console.
				</p>
			</div>

			<CreateOrgForm />

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["Organization", "Type", "Status", "Members", "Ponds", "Created"].map((h) => (
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
							{orgs.map((org) => (
								<tr
									key={org.id}
									className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
								>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center text-white">
												<FolderTree className="w-4 h-4" />
											</div>
											<p className="font-black text-[#0A3D62]">{org.name}</p>
										</div>
									</td>
									<td className="px-6 py-4">
										<span
											className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${typeBadge[org.type] ?? "bg-gray-200 text-[#3D5568]"}`}
										>
											{org.type}
										</span>
									</td>
									<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">{org.status}</td>
									<td className="px-6 py-4 tabular-nums font-black text-[#0A3D62]">
										{org.memberCount}
									</td>
									<td className="px-6 py-4 tabular-nums font-black text-[#0A3D62]">
										{org.pondCount}
									</td>
									<td className="px-6 py-4 text-xs text-[#3D5568]">
										{org.createdAt.toLocaleDateString()}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{orgs.length === 0 && (
					<p className="p-6 text-sm text-[#3D5568]">
						No organizations yet. Create one below — tenant admins and farmers are added to an
						organization.
					</p>
				)}
			</div>
		</div>
	);
}
