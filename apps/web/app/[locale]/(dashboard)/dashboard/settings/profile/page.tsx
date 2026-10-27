import { ChangePasswordForm } from "@/components/change-password-form";
import { dashboardField, dashboardLabel } from "@/components/dashboard/dashboard-classes";
import {
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { NotificationPrefsForm } from "@/components/notification-prefs-form";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { Link } from "@/i18n/routing";
import { canWrite, getCurrentUser } from "@/lib/auth/session";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { DPO_EMAIL, LEGAL_APP_RELEASE, LEGAL_PUBLISHED, LEGAL_VERSION } from "@/lib/legal/config";
import { getActivePond } from "@/lib/pond-selection";
import { createClient } from "@/lib/supabase/server";
import { Camera, FileText, Shield, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function ProfileSettingsPage() {
	const [t, tAvatar, tLegal, tCommon] = await Promise.all([
		getTranslations("dashboard.profileSettings"),
		getTranslations("dashboard.profileSettings.avatar"),
		getTranslations("legal"),
		getTranslations("dashboard.common"),
	]);

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	const email = user?.email ?? "";
	const displayName = email.split("@")[0] || t("defaultName");

	const currentUser = await getCurrentUser();
	const farmId = currentUser?.farmId ?? "\u2014";
	const writeAccess = await canWrite();

	const avatarUrls = currentUser
		? await getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }])
		: {};
	const avatarUrl = currentUser ? (avatarUrls[currentUser.id] ?? null) : null;

	const pond = await getActivePond();
	const notificationPrefs = pond?.notificationPrefs ?? {
		missedFeeding: true,
		deviceOffline: true,
		hopperLow: true,
	};

	const disabledField = `${dashboardField} cursor-not-allowed bg-gray-50 text-[#3D5568] dark:bg-gray-800 dark:text-gray-400`;

	return (
		<div className="w-full space-y-6 pb-20">
			<DashboardPageHeader title={t("title")} description={t("desc")} icon={User} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			<DashboardSection title={tAvatar("title")} description={tAvatar("desc")} icon={Camera}>
				<AvatarUpload
					avatarUrl={avatarUrl}
					name={currentUser?.displayName ?? currentUser?.farmId ?? email}
					canEdit={writeAccess}
				/>
			</DashboardSection>

			<DashboardSection title={t("profileInfo")} description={t("profileInfoDesc")} icon={User}>
				<div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
					<div>
						<label htmlFor="fullName" className={dashboardLabel}>
							{t("fullName")}
						</label>
						<input id="fullName" type="text" defaultValue={displayName} className={disabledField} />
					</div>
					<div>
						<label htmlFor="role" className={dashboardLabel}>
							{t("role")}
						</label>
						<input
							id="role"
							type="text"
							defaultValue={currentUser?.role ?? "\u2014"}
							disabled
							className={disabledField}
						/>
					</div>
					<div>
						<label htmlFor="farmId" className={dashboardLabel}>
							{t("farmId")}
						</label>
						<input
							id="farmId"
							type="text"
							defaultValue={farmId}
							disabled
							className={`${disabledField} break-all font-mono`}
						/>
					</div>
					<div>
						<label htmlFor="email" className={dashboardLabel}>
							{t("email")}
						</label>
						<input
							id="email"
							type="email"
							defaultValue={email}
							disabled
							className={`${disabledField} break-all`}
						/>
					</div>
				</div>

				<div className="mt-6">
					<button
						type="button"
						disabled
						aria-describedby="profile-managed-note"
						className="inline-flex min-h-11 min-w-[120px] cursor-not-allowed items-center justify-center rounded-xl bg-[#C2410C] px-6 text-sm font-black text-white opacity-60"
					>
						{t("saveChanges")}
					</button>
					<p id="profile-managed-note" className="mt-2 text-xs text-[#3D5568] dark:text-gray-400">
						{t("managedByAdmin")}
					</p>
				</div>
			</DashboardSection>

			<DashboardSection title={t("security")} description={t("securityDesc")} icon={Shield}>
				<ChangePasswordForm />
			</DashboardSection>

			{LEGAL_PUBLISHED ? (
				<DashboardSection
					title={tLegal("profileTitle")}
					description={tLegal("profileDesc")}
					icon={FileText}
				>
					<div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
						<Link
							href="/privacy"
							className="inline-flex min-h-11 items-center font-bold text-[#C2410C] underline underline-offset-2 hover:text-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-[#ff8a5c] dark:focus-visible:ring-[#8fc0ea]"
						>
							{tLegal("privacy")}
						</Link>
						<Link
							href="/terms"
							className="inline-flex min-h-11 items-center font-bold text-[#C2410C] underline underline-offset-2 hover:text-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-[#ff8a5c] dark:focus-visible:ring-[#8fc0ea]"
						>
							{tLegal("terms")}
						</Link>
						<a
							href={`mailto:${DPO_EMAIL}`}
							className="inline-flex min-h-11 items-center font-bold text-[#C2410C] underline underline-offset-2 hover:text-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-[#ff8a5c] dark:focus-visible:ring-[#8fc0ea]"
						>
							{tLegal("privacyContact")}
						</a>
					</div>

					<p className="mt-4 text-xs text-[#3D5568] dark:text-gray-400">
						{tLegal("profileVersion", {
							version: LEGAL_VERSION,
							release: LEGAL_APP_RELEASE,
						})}
					</p>
				</DashboardSection>
			) : null}

			<NotificationPrefsForm
				pondId={pond?.id ?? ""}
				initialPrefs={notificationPrefs}
				canWrite={writeAccess}
			/>
		</div>
	);
}
