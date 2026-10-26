import { adminButtonPrimary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminCard,
	AdminCardList,
	AdminCardRow,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";
import { UserPermissionsDialog } from "@/components/admin/user-permissions-dialog";
import { Link } from "@/i18n/routing";
import { getUsers } from "@/lib/actions/admin";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateTimeLocal } from "@/lib/date-local";
import { Eye, Shield, User, Users } from "lucide-react";
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

export default async function AdminUsersPage() {
	const [users, currentUser, t, tCommon, tDates] = await Promise.all([
		getUsers(),
		getCurrentUser(),
		getTranslations("dashboard.adminUsers"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dates"),
	]);

	const roleLabel = (role: string) =>
		tCommon.has(`roleName.${role}`) ? tCommon(`roleName.${role}`) : role;
	const joined = (date: Date) => formatDateTimeLocal(date, tDates).fullDate;

	return (
		<div className="space-y-6">
			<AdminPageHeader
				icon={Users}
				title={t("title")}
				description={t("desc", { count: users.length })}
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
				<>
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
												<div
													aria-hidden="true"
													className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C2410C] text-xs font-black text-white"
												>
													{user.displayName
														? user.displayName.slice(0, 2).toUpperCase()
														: user.farmId.slice(0, 2).toUpperCase()}
												</div>
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
											<UserPermissionsDialog
												userId={user.id}
												userName={user.displayName || user.farmId}
												permissions={PERMISSIONS}
												isSelf={currentUser?.id === user.id}
											/>
										</AdminTd>
									</AdminTr>
								);
							})}
						</tbody>
					</AdminTable>

					<AdminCardList>
						{users.map((user) => {
							const badge = roleBadge[user.role] ?? roleBadge.VIEWER;
							const Icon = badge.icon;
							return (
								<AdminCard key={user.id}>
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 items-center gap-3">
											<div
												aria-hidden="true"
												className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C2410C] text-xs font-black text-white"
											>
												{user.displayName
													? user.displayName.slice(0, 2).toUpperCase()
													: user.farmId.slice(0, 2).toUpperCase()}
											</div>
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
										<UserPermissionsDialog
											userId={user.id}
											userName={user.displayName || user.farmId}
											permissions={PERMISSIONS}
											isSelf={currentUser?.id === user.id}
										/>
									</div>
								</AdminCard>
							);
						})}
					</AdminCardList>
				</>
			)}
		</div>
	);
}
