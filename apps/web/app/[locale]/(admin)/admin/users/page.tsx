import { Link } from "@/i18n/routing";
import { getUsers } from "@/lib/actions/admin";
import { Eye, Plus, Shield, User } from "lucide-react";

const roleBadge: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
	ADMIN: { bg: "bg-[#E85A2A]", text: "text-white", icon: Shield },
	OPERATOR: { bg: "bg-[#0A3D62]", text: "text-white", icon: User },
	VIEWER: { bg: "bg-gray-200", text: "text-[#3D5568]", icon: Eye },
};

export default async function AdminUsersPage() {
	const users = await getUsers();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-black text-[#0A3D62]">User Management</h1>
					<p className="text-sm text-[#3D5568] mt-1">
						{users.length} user{users.length !== 1 ? "s" : ""} registered
					</p>
				</div>
				<Link
					href="/admin/users/create"
					className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#E85A2A] text-white font-bold text-sm rounded-xl hover:bg-[#d04a1f] transition-colors shadow-sm"
				>
					<Plus className="w-4 h-4" />
					Create User
				</Link>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									User
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Farm ID
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Role
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Created
								</th>
							</tr>
						</thead>
						<tbody>
							{users.map((user) => {
								const badge = roleBadge[user.role] || roleBadge.VIEWER;
								const Icon = badge.icon;
								return (
									<tr
										key={user.id}
										className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
									>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-9 h-9 rounded-xl bg-[#E85A2A] flex items-center justify-center text-white font-black text-xs">
													{user.displayName
														? user.displayName.slice(0, 2).toUpperCase()
														: user.farmId.slice(0, 2).toUpperCase()}
												</div>
												<div>
													<p className="font-black text-[#0A3D62]">
														{user.displayName || user.farmId}
													</p>
													<p className="text-[11px] text-[#3D5568]">{user.email}</p>
												</div>
											</div>
										</td>
										<td className="px-6 py-4 font-mono text-xs font-bold text-[#3D5568]">
											{user.farmId}
										</td>
										<td className="px-6 py-4">
											<span
												className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${badge.bg} ${badge.text}`}
											>
												<Icon className="w-3 h-3" />
												{user.role}
											</span>
										</td>
										<td className="px-6 py-4 text-xs text-[#3D5568]">
											{user.createdAt.toLocaleDateString()}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
