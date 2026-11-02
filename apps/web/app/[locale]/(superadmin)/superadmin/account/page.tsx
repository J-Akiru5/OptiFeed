import { LogoutButton } from "@/components/LogoutButton";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { Card, MetaPair, PageHeader, SectionTitle } from "@/components/superadmin/ui";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { canWrite, requirePasswordChanged } from "@/lib/auth/session";
import { getSignedAvatarUrls } from "@/lib/avatars";
import { getTranslations } from "next-intl/server";

/**
 * The platform admin's own account (issue #560).
 *
 * The console previously had no account surface of its own: the header linked
 * to `/dashboard/settings/profile`, which only exists for a platform admin who
 * is also a tenant member. This page gives every platform admin a profile,
 * password change and sign-out without needing a farm.
 */
export default async function SuperadminAccountPage() {
	const [t] = await Promise.all([getTranslations("superadmin.account")]);
	const currentUser = await requirePasswordChanged();
	await requirePlatformAdmin();

	const [avatarUrls, writeAccess] = await Promise.all([
		getSignedAvatarUrls([{ id: currentUser.id, avatarPath: currentUser.avatarPath }]),
		canWrite(),
	]);

	const displayName = currentUser.displayName ?? currentUser.farmId;
	const email = currentUser.contactEmail ?? currentUser.email;

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<Card>
					<SectionTitle title={t("identity")} description={t("identityDesc")} />
					<dl className="mt-4 grid gap-4 sm:grid-cols-2">
						<MetaPair label={t("displayName")}>{displayName}</MetaPair>
						<MetaPair label={t("role")}>{currentUser.role}</MetaPair>
						<MetaPair label={t("farmId")}>{currentUser.farmId}</MetaPair>
						<MetaPair label={t("email")}>{email}</MetaPair>
					</dl>
				</Card>

				<Card>
					<SectionTitle title={t("avatar")} description={t("avatarDesc")} />
					<div className="mt-4">
						<AvatarUpload
							avatarUrl={avatarUrls[currentUser.id] ?? null}
							name={displayName}
							canEdit={writeAccess}
						/>
					</div>
				</Card>
			</div>

			<Card>
				<SectionTitle title={t("password")} description={t("passwordDesc")} />
				<div className="mt-4 max-w-md">
					<ChangePasswordForm />
				</div>
			</Card>

			<Card>
				<SectionTitle title={t("session")} description={t("sessionDesc")} />
				<div className="mt-4">
					<LogoutButton />
				</div>
			</Card>
		</div>
	);
}
