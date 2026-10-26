import { UserActions } from "@/components/superadmin/user-actions";
import { Link, getPathname } from "@/i18n/routing";
import { listAllUsers } from "@/lib/actions/superadmin";
import { Eye, Plus, Search, Shield, ShieldCheck, User } from "lucide-react";
import { getLocale } from "next-intl/server";

const roleBadge: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
	ADMIN: { bg: "bg-[#E85A2A]", text: "text-white", icon: Shield },
	OPERATOR: { bg: "bg-[#0A3D62]", text: "text-white", icon: User },
	VIEWER: { bg: "bg-gray-200", text: "text-[#3D5568]", icon: Eye },
};

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

export default async function SuperadminUsersPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const query = first(params.q)?.trim() ?? "";
	const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

	const [users, locale] = await Promise.all([listAllUsers({ query, page }), getLocale()]);
	const pageCount = Math.max(1, Math.ceil(users.total / users.pageSize));

	const pageHref = (target: number) => ({
		pathname: "/superadmin/users",
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-black text-[#0A3D62]">All Users</h1>
					<p className="text-sm text-[#3D5568] mt-1">
						{users.total} account{users.total !== 1 ? "s" : ""} across every tenant
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

			<form
				action={getPathname({ href: "/superadmin/users", locale })}
				method="get"
				className="flex items-center gap-2"
			>
				<input
					name="q"
					defaultValue={query}
					placeholder="Search farm ID, email or name"
					aria-label="Search users by farm ID, email or display name"
					className="w-64 px-3 py-2 bg-white text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
				<button
					type="submit"
					className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
				>
					<Search className="w-3.5 h-3.5" />
					Search
				</button>
			</form>

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
							{users.rows.map((user) => {
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
											{user.disabled && (
												<span className="ml-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-200 text-[#3D5568] text-[10px] font-black uppercase tracking-wider">
													Disabled
												</span>
											)}
										</td>

										<td className="px-6 py-4">
											<UserActions
												userId={user.id}
												farmId={user.farmId}
												isPlatformAdmin={user.isPlatformAdmin}
												disabled={user.disabled}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{users.rows.length === 0 && (
					<p className="p-6 text-sm text-[#3D5568]">
						{query ? `No account matches “${query}”.` : "No users registered."}
					</p>
				)}
			</div>

			{pageCount > 1 && (
				<nav aria-label="User pages" className="flex items-center gap-3 text-xs font-black">
					{users.page > 1 && (
						<Link href={pageHref(users.page - 1)} className="text-[#0A3D62] hover:underline">
							← Previous
						</Link>
					)}
					<span className="text-[#3D5568]">
						Page {users.page} of {pageCount}
					</span>
					{users.page < pageCount && (
						<Link href={pageHref(users.page + 1)} className="text-[#0A3D62] hover:underline">
							Next →
						</Link>
					)}
				</nav>
			)}
		</div>
	);
}
