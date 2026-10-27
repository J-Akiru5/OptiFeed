import { ListToolbar } from "@/components/superadmin/list-chrome";
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
import { Pagination } from "@/components/ui/pagination";
import { Link, getPathname } from "@/i18n/routing";
import { listAllUsers } from "@/lib/actions/superadmin";
import { Eye, Plus, Shield, ShieldCheck, User, UserX, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

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

	const [users, locale, t, tCommon, tRoot] = await Promise.all([
		listAllUsers({ query, page }),
		getLocale(),
		getTranslations("superadmin.users"),
		getTranslations("superadmin.common"),
		getTranslations("superadmin"),
	]);
	const pageCount = Math.max(1, Math.ceil(users.total / users.pageSize));
	const firstRow = users.total === 0 ? 0 : (users.page - 1) * users.pageSize + 1;
	const lastRow = Math.min(users.page * users.pageSize, users.total);

	const roleLabel = (role: string) => {
		const key = `roles.${role}`;
		return tRoot.has(key) ? tRoot(key) : role;
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: users.total })}
				actions={
					<Link
						href="/superadmin/users/create"
						data-help="superadmin-new-user"
						className={PRIMARY_BUTTON}
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						{t("newAccount")}
					</Link>
				}
			/>

			<ListToolbar
				id="users"
				action={getPathname({ href: "/superadmin/users", locale })}
				query={query}
				label={t("searchLabel")}
				placeholder={t("searchPlaceholder")}
				searchLabel={tCommon("search")}
			/>

			{users.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Users}
						title={query ? t("emptyQuery", { query }) : t("emptyTitle")}
						description={query ? t("emptyQueryDesc") : t("emptyDesc")}
						action={
							query ? (
								<Link href="/superadmin/users" className={SECONDARY_BUTTON}>
									{tCommon("clearSearch")}
								</Link>
							) : (
								<Link
									href="/superadmin/users/create"
									data-help="superadmin-new-user"
									className={PRIMARY_BUTTON}
								>
									{t("newAccount")}
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
											{roleLabel(user.role)}
										</Badge>
										{user.isPlatformAdmin && (
											<Badge tone="accent" icon={ShieldCheck}>
												{tCommon("platform")}
											</Badge>
										)}
										{user.disabled && (
											<Badge tone="neutral" icon={UserX}>
												{tCommon("disabled")}
											</Badge>
										)}
									</div>

									<div>
										<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
											{t("organizationsLabel")}
										</p>
										{user.orgs.length === 0 ? (
											<p className="mt-1 text-[11px] italic text-[#3D5568]">
												{tCommon("noOrganization")}
											</p>
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
										{t("pondCount", { count: user.pondCount })}
									</p>
								</MobileCard>
							);
						})}
					</ul>

					<TableFrame
						className="hidden md:block"
						label={t("caption")}
						minWidth="min-w-[60rem]"
						columns={[
							{ key: "user", label: t("columnUser") },
							{ key: "role", label: t("columnRole") },
							{ key: "orgs", label: t("columnOrgs") },
							{ key: "ponds", label: t("columnPonds") },
							{ key: "access", label: t("columnAccess") },
							{ key: "actions", label: t("columnActions"), className: "text-right" },
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
											{roleLabel(user.role)}
										</Badge>
									</td>

									<td className="px-6 py-4">
										{user.orgs.length === 0 ? (
											<span className="text-[11px] italic text-[#3D5568]">
												{tCommon("noOrganization")}
											</span>
										) : (
											<div className="flex flex-wrap gap-1.5">
												{user.orgs.map((org) => (
													<span
														key={org.id}
														title={t("memberCount", { count: org.memberCount })}
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
													{tCommon("platform")}
												</Badge>
											) : (
												<span className="text-[11px] text-[#3D5568]">{tCommon("none")}</span>
											)}
											{user.disabled && (
												<Badge tone="neutral" icon={UserX}>
													{tCommon("disabled")}
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

			<Pagination
				basePath="/superadmin/users"
				params={{ q: query || undefined }}
				page={users.page}
				pageCount={pageCount}
				showing={tCommon("pagination.showing", {
					from: firstRow,
					to: lastRow,
					total: users.total,
				})}
				previousLabel={tCommon("previous")}
				nextLabel={tCommon("next")}
				label={tCommon("pagination.label")}
			/>
		</div>
	);
}
