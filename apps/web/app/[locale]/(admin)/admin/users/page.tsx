import { adminButtonPrimary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminCard,
	AdminCardRow,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/i18n/routing";
import { getUsers } from "@/lib/actions/admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { parsePage } from "@/lib/pagination";
import { Eye, KeyRound, Shield, User, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

const roleBadge: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
	OWNER: { bg: "bg-[#1E7B34]", text: "text-white", icon: Shield },
	ADMIN: { bg: "bg-[#C2410C]", text: "text-white", icon: Shield },
	OPERATOR: { bg: "bg-[#0A3D62]", text: "text-white", icon: User },
	VIEWER: {
		bg: "bg-gray-200 dark:bg-gray-700",
		text: "text-[#3D5568] dark:text-gray-200",
		icon: Eye,
	},
};

const permissionsLinkClass =
	"inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-600 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]";

export default async function AdminUsersPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [usersPage, t, tCommon, tDates] = await Promise.all([
		getUsers({ page }),
		getTranslations("dashboard.adminUsers"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dates"),
	]);
	const users = usersPage.rows;
	const pageCount = Math.max(1, Math.ceil(usersPage.total / usersPage.pageSize));
	const firstRow = usersPage.total === 0 ? 0 : (usersPage.page - 1) * usersPage.pageSize + 1;
	const lastRow = Math.min(usersPage.page * usersPage.pageSize, usersPage.total);

	const roleLabel = (role: string) =>
		tCommon.has(`roleName.${role}`) ? tCommon(`roleName.${role}`) : role;
	const joined = (date: Date) => formatDateTimeLocal(date, tDates).fullDate;

	return (
		<div className="space-y-6">
			<AdminPageHeader
				icon={Users}
				title={t("title")}
				description={t("desc", { count: usersPage.total })}
			>
				<p className="mt-2 max-w-2xl text-[11px] text-[#3D5568] dark:text-gray-400">
					{t("farmersBefore")}{" "}
					<Link
						href="/admin/ponds/new"
						className="font-bold text-[#C2410C] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
					>
						{t("farmersLink")}
					</Link>
					{t("farmersAfter")}
				</p>
			</AdminPageHeader>

			{users.length === 0 ? (
				<AdminEmptyState
					icon={Users}
					title={t("emptyTitle")}
					description={t("emptyDesc")}
					action={
						<Link href="/admin/ponds/new" className={adminButtonPrimary}>
							{t("emptyAction")}
						</Link>
					}
				/>
			) : (
				<ListView
					pageKey="admin-users"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<AdminTable caption={t("caption")} minWidth="min-w-[46rem]">
						<AdminTHead>
							<AdminTh>{t("columnUser")}</AdminTh>
							<AdminTh>{t("columnFarm")}</AdminTh>
							<AdminTh>{t("columnRole")}</AdminTh>
							<AdminTh>{t("columnCreated")}</AdminTh>
							<AdminTh align="right">{tCommon("actions")}</AdminTh>
						</AdminTHead>
						<tbody>
							{users.map((user) => {
								const badge = roleBadge[user.role] ?? roleBadge.VIEWER;
								const Icon = badge.icon;
								return (
									<AdminTr key={user.id}>
										<AdminTd>
											<div className="flex items-center gap-3">
												<UserAvatar
													src={user.avatarUrl}
													name={user.displayName || user.farmId}
													size="md"
													className="rounded-xl bg-[#C2410C]"
												/>
												<div className="min-w-0">
													<p className="font-black text-[#0A3D62] dark:text-gray-100">
														{user.displayName || user.farmId}
													</p>
													<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
														{user.email}
													</p>
												</div>
											</div>
										</AdminTd>
										<AdminTd>
											<p className="font-black text-[#0A3D62] dark:text-gray-100">
												{user.farm?.name ?? user.farmId}
											</p>
											<p className="font-mono text-[11px] text-[#3D5568] dark:text-gray-400">
												{user.farmId}
											</p>
										</AdminTd>
										<AdminTd>
											<span
												className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${badge.bg} ${badge.text}`}
											>
												<Icon aria-hidden="true" className="h-3 w-3" />
												{roleLabel(user.role)}
											</span>
										</AdminTd>
										<AdminTd className="text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-400">
											{joined(user.createdAt)}
										</AdminTd>
										<AdminTd className="text-right">
											<Link
												href={`/admin/settings/members/${user.id}/permissions`}
												aria-label={`${t("permissionsButton")} — ${user.displayName || user.farmId}`}
												className={permissionsLinkClass}
											>
												<KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
												{t("permissionsButton")}
											</Link>
										</AdminTd>
									</AdminTr>
								);
							})}
						</tbody>
					</AdminTable>

					<ItemCardGrid label={t("caption")}>
						{users.map((user) => {
							const badge = roleBadge[user.role] ?? roleBadge.VIEWER;
							const Icon = badge.icon;
							return (
								<AdminCard key={user.id}>
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<UserAvatar
												src={user.avatarUrl}
												name={user.displayName || user.farmId}
												size="md"
												className="rounded-xl bg-[#C2410C]"
											/>
											<div className="min-w-0">
												<p className="truncate font-black text-[#0A3D62] dark:text-gray-100">
													{user.displayName || user.farmId}
												</p>
												<p className="truncate text-[11px] text-[#3D5568] dark:text-gray-400">
													{user.email}
												</p>
											</div>
										</div>
										<span
											className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${badge.bg} ${badge.text}`}
										>
											<Icon aria-hidden="true" className="h-3 w-3" />
											{roleLabel(user.role)}
										</span>
									</div>

									<div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800">
										<AdminCardRow label={t("columnFarm")}>
											{user.farm?.name ?? user.farmId}
										</AdminCardRow>
										<AdminCardRow label={t("columnCreated")}>{joined(user.createdAt)}</AdminCardRow>
									</div>

									<div className="mt-3">
										<Link
											href={`/admin/settings/members/${user.id}/permissions`}
											aria-label={`${t("permissionsButton")} — ${user.displayName || user.farmId}`}
											className={permissionsLinkClass}
										>
											<KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
											{t("permissionsButton")}
										</Link>
									</div>
								</AdminCard>
							);
						})}
					</ItemCardGrid>
				</ListView>
			)}

			{usersPage.total > 0 && (
				<Pagination
					basePath="/admin/users"
					page={usersPage.page}
					pageCount={pageCount}
					showing={tCommon("pagination.showing", {
						from: firstRow,
						to: lastRow,
						total: usersPage.total,
					})}
					previousLabel={tCommon("pagination.previous")}
					nextLabel={tCommon("pagination.next")}
					label={tCommon("pagination.label")}
				/>
			)}
		</div>
	);
}
