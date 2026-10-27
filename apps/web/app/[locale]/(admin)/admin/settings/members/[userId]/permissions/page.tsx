import { adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MemberPermissions } from "@/components/admin/member-permissions";
import { Link } from "@/i18n/routing";
import { getUserPermissionState, listTenantMembers } from "@/lib/actions/admin";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ChevronLeft, KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

/**
 * Dedicated per-member permission page (#189).
 *
 * Replaces the modal that used to open from Settings → Members. The page reads
 * and writes through the same guarded server actions (`getUserPermissionState`,
 * `setUserPermission`); only the presentation changed.
 */
export default async function MemberPermissionsPage({
	params,
}: {
	params: Promise<{ userId: string }>;
}) {
	const { userId } = await params;
	const [members, t, tMembers] = await Promise.all([
		listTenantMembers({ userId }),
		getTranslations("dashboard.adminUsers"),
		getTranslations("dashboard.adminMembers"),
	]);

	const member = members.rows.find((row) => row.userId === userId);
	if (!member) notFound();

	const name = member.displayName || member.farmId;
	// Mirror the Members table: a platform admin is managed from /superadmin and
	// only an owner may edit another owner.
	const ownerLocked = member.role === "OWNER" && member.callerRole !== "OWNER";
	const managedElsewhere = member.isPlatformAdmin || ownerLocked;

	const state = managedElsewhere ? null : await getUserPermissionState(userId);

	return (
		<div className="space-y-6">
			<Link
				href="/admin/settings"
				className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-black text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-[#8fc0ea] dark:hover:text-[#ff8a5c] dark:focus-visible:outline-[#8fc0ea]"
			>
				<ChevronLeft aria-hidden="true" className="h-4 w-4" />
				{t("backToSettings")}
			</Link>

			<AdminPageHeader
				icon={KeyRound}
				title={t("permissionsTitle", { name })}
				description={t("permissionsDesc")}
			>
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#3D5568] dark:text-gray-400">
					<span className="break-all">{member.email}</span>
					<span className="rounded-full bg-[#0A3D62] px-2.5 py-1 text-[10px] font-black tracking-wider text-white uppercase dark:bg-[#8fc0ea]/20 dark:text-[#8fc0ea]">
						{tMembers(`role.${member.role}`)}
					</span>
				</div>
			</AdminPageHeader>

			<section className={`${adminSurface} p-4 sm:p-6`}>
				{managedElsewhere ? (
					<p className="rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-bold text-[#3D5568] dark:border-gray-700/60 dark:bg-gray-800/60 dark:text-gray-300">
						{member.isPlatformAdmin ? tMembers("platformAdminLocked") : tMembers("ownerLocked")}
					</p>
				) : state?.success ? (
					<MemberPermissions
						userId={userId}
						permissions={PERMISSIONS}
						initialState={state}
						isSelf={member.isSelf}
					/>
				) : (
					<p
						role="alert"
						className="rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3 text-xs font-bold text-[#C42B3A] dark:bg-red-950/40 dark:text-red-300"
					>
						{t("loadError")}
					</p>
				)}
			</section>
		</div>
	);
}
