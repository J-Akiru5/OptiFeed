import { ListPagination, ListToolbar } from "@/components/superadmin/list-chrome";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	MobileCard,
	PRIMARY_BUTTON,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { UserActions } from "@/components/superadmin/user-actions";
import { Link, getPathname } from "@/i18n/routing";
import { listAllUsers } from "@/lib/actions/superadmin";
import { Eye, Plus, Shield, ShieldCheck, User, UserX, Users } from "lucide-react";
import { getLocale } from "next-intl/server";

const roleBadge: Record<string, { tone: BadgeTone; icon: typeof Shield }> = {
	ADMIN: { tone: "accent", icon: Shield },
	OPERATOR: { tone: "brand", icon: User },
	VIEWER: { tone: "neutral", icon: Eye },
};

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

function initials(user: { displayName: string | null; farmId: string }): string {
	return (user.displayName || user.farmId).slice(0, 2).toUpperCase();
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
		pathname: "/superadmin/users" as const,
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<PageHeader
				title="All Users"
				description={`${users.total} account${users.total !== 1 ? "s" : ""} across every tenant`}
				actions={
					<Link href="/superadmin/users/create" className={PRIMARY_BUTTON}>
						<Plus className="h-4 w-4" aria-hidden="true" />
						New Account
					</Link>
				}
			/>

			<ListToolbar
				id="users"
				action={getPathname({ href: "/superadmin/users", locale })}
				query={query}
				label="Search users by farm ID, email or display name"
				placeholder="Search farm ID, email or name"
			/>

			{users.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Users}
						title={query ? `No account matches “${query}”.` : "No users registered."}
						description={
							query
								? "Try a different farm ID, email or display name."
								: "Create the first account with New Account; it can be a tenant admin or a farmer."
						}
						action={
							query ? (
								<Link href="/superadmin/users" className={SECONDARY_BUTTON}>
									Clear search
								</Link>
							) : (
								<Link href="/superadmin/users/create" className={PRIMARY_BUTTON}>
									New Account
								</Link>
							)
						}
					/>
				</Card>
			) : (
				<>
					<ul className="space-y-3 md:hidden">
						{users.rows.map((user) => {
							const badge = roleBadge[user.role] || roleBadge.VIEWER;
							return (
								<MobileCard key={user.id}>
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<div
												aria-hidden="true"
												className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62] text-xs font-black text-white"
											>
												{initials(user)}
											</div>
											<div className="min-w-0">
												<p className="truncate font-black text-[#0A3D62]">
													{user.displayName || user.farmId}
												</p>
												<p className="truncate text-[11px] text-[#3D5568]">{user.email}</p>
												<p className="truncate font-mono text-[11px] text-[#3D5568]">
													{user.farmId}
												</p>
											</div>
										</div>
										<UserActions
											userId={user.id}
											farmId={user.farmId}
											isPlatformAdmin={user.isPlatformAdmin}
											disabled={user.disabled}
										/>
									</div>

									<div className="flex flex-wrap items-center gap-1.5">
										<Badge tone={badge.tone} icon={badge.icon}>
											{user.role}
										</Badge>
										{user.isPlatformAdmin && (
											<Badge tone="accent" icon={ShieldCheck}>
												Platform
											</Badge>
										)}
										{user.disabled && (
											<Badge tone="neutral" icon={UserX}>
												Disabled
											</Badge>
										)}
									</div>

									<div>
										<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
											Organizations
										</p>
										{user.orgs.length === 0 ? (
											<p className="mt-1 text-[11px] italic text-[#3D5568]">No organization</p>
										) : (
											<div className="mt-1 flex flex-wrap gap-1.5">
												{user.orgs.map((org) => (
													<span
														key={org.id}
														className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-[#F4F7F6] px-2 py-0.5 text-[10px] font-bold text-[#0A3D62]"
													>
														{org.name}
														<span className="text-[#8A4A00]">{org.role}</span>
													</span>
												))}
											</div>
										)}
									</div>

									<p className="text-xs font-bold text-[#3D5568]">
										<span className="font-black tabular-nums text-[#0A3D62]">{user.pondCount}</span>{" "}
										pond{user.pondCount === 1 ? "" : "s"}
									</p>
								</MobileCard>
							);
						})}
					</ul>

					<TableFrame
						className="hidden md:block"
						label="All platform users"
						minWidth="min-w-[60rem]"
						columns={[
							{ key: "user", label: "User" },
							{ key: "role", label: "Role" },
							{ key: "orgs", label: "Organizations" },
							{ key: "ponds", label: "Ponds" },
							{ key: "access", label: "Access" },
							{ key: "actions", label: "Actions", className: "text-right" },
						]}
					>
						{users.rows.map((user) => {
							const badge = roleBadge[user.role] || roleBadge.VIEWER;
							return (
								<tr
									key={user.id}
									className="border-b border-gray-50 transition-colors last:border-0 hover:bg-[#F4F7F6]/50"
								>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<div
												aria-hidden="true"
												className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62] text-xs font-black text-white"
											>
												{initials(user)}
											</div>
											<div className="min-w-0">
												<p className="font-black text-[#0A3D62]">
													{user.displayName || user.farmId}
												</p>
												<p className="text-[11px] text-[#3D5568]">{user.email}</p>
												<p className="font-mono text-[11px] text-[#3D5568]">{user.farmId}</p>
											</div>
										</div>
									</td>

									<td className="px-6 py-4">
										<Badge tone={badge.tone} icon={badge.icon}>
											{user.role}
										</Badge>
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
														className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-[#F4F7F6] px-2 py-0.5 text-[10px] font-bold text-[#0A3D62]"
													>
														{org.name}
														<span className="text-[#8A4A00]">{org.role}</span>
													</span>
												))}
											</div>
										)}
									</td>

									<td className="px-6 py-4 font-black tabular-nums text-[#0A3D62]">
										{user.pondCount}
									</td>

									<td className="px-6 py-4">
										<div className="flex flex-wrap items-center gap-1.5">
											{user.isPlatformAdmin ? (
												<Badge tone="accent" icon={ShieldCheck}>
													Platform
												</Badge>
											) : (
												<span className="text-[11px] text-[#3D5568]">—</span>
											)}
											{user.disabled && (
												<Badge tone="neutral" icon={UserX}>
													Disabled
												</Badge>
											)}
										</div>
									</td>

									<td className="px-6 py-4">
										<div className="flex items-center justify-end">
											<UserActions
												userId={user.id}
												farmId={user.farmId}
												isPlatformAdmin={user.isPlatformAdmin}
												disabled={user.disabled}
											/>
										</div>
									</td>
								</tr>
							);
						})}
					</TableFrame>
				</>
			)}

			<ListPagination
				label="User pages"
				page={users.page}
				pageCount={pageCount}
				previousHref={users.page > 1 ? pageHref(users.page - 1) : null}
				nextHref={users.page < pageCount ? pageHref(users.page + 1) : null}
			/>
		</div>
	);
}
