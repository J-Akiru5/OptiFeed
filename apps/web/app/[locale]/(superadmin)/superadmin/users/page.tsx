import { UserActions } from "@/components/superadmin/user-actions";
import { Link } from "@/i18n/routing";
import { listAllUsers } from "@/lib/actions/superadmin";
import { Eye, Plus, Shield, ShieldCheck, User } from "lucide-react";

const roleBadge: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
	ADMIN: { bg: "bg-[#E85A2A]", text: "text-white", icon: Shield },
	OPERATOR: { bg: "bg-[#0A3D62]", text: "text-white", icon: User },
	VIEWER: { bg: "bg-gray-200", text: "text-[#3D5568]", icon: Eye },
};

export default async function SuperadminUsersPage() {
	const users = await listAllUsers();

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-black text-[#0A3D62]">All Users</h1>
					<p className="text-sm text-[#3D5568] mt-1">
						{users.length} account{users.length !== 1 ? "s" : ""} across every tenant
					</p>
				</div>
				<Link
					href="/superadmin/users/create"
					className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#E85A2A] text-white font-bold text-sm rounded-xl hover:bg-[#d04a1f] transition-colors shadow-sm"
				>
					<Plus className="w-4 h-4" />
					New Account
				</Link>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["User", "Role", "Organizations", "Ponds", "Access", ""].map((h) => (
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
												<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center text-white font-black text-xs">
													{user.displayName
														? user.displayName.slice(0, 2).toUpperCase()
														: user.farmId.slice(0, 2).toUpperCase()}
												</div>
												<div>
													<p className="font-black text-[#0A3D62]">
														{user.displayName || user.farmId}
													</p>
													<p className="text-[11px] text-[#3D5568]">{user.email}</p>
													<p className="text-[11px] font-mono text-[#3D5568]">{user.farmId}</p>
												</div>
											</div>
										</td>

										<td className="px-6 py-4">
											<span
												className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${badge.bg} ${badge.text}`}
											>
												<Icon className="w-3 h-3" />
												{user.role}
											</span>
										</td>

										<td className="px-6 py-4">
											{user.orgs.length === 0 ? (
												<span className="text-[11px] italic text-[#3D5568]">No organization</span>
											) : (
												<div className="flex flex-wrap gap-1.5">
													{user.orgs.map((org) => (
														<span
															key={org.id}
															title={`${org.memberCount} active member(s)`}
															className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#F4F7F6] border border-gray-200 text-[10px] font-bold text-[#0A3D62]"
														>
															{org.name}
															<span className="text-[#E85A2A]">{org.role}</span>
														</span>
													))}
												</div>
											)}
										</td>

										<td className="px-6 py-4 tabular-nums font-black text-[#0A3D62]">
											{user.pondCount}
										</td>

										<td className="px-6 py-4">
											{user.isPlatformAdmin ? (
												<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E85A2A] text-white text-[10px] font-black uppercase tracking-wider">
													<ShieldCheck className="w-3 h-3" />
													Platform
												</span>
											) : (
												<span className="text-[11px] text-[#3D5568]">—</span>
											)}
										</td>

										<td className="px-6 py-4">
											<UserActions
												userId={user.id}
												farmId={user.farmId}
												isPlatformAdmin={user.isPlatformAdmin}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{users.length === 0 && <p className="p-6 text-sm text-[#3D5568]">No users registered.</p>}
			</div>
		</div>
	);
}
