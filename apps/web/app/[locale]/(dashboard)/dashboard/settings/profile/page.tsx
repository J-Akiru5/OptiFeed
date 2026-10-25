import { ChangePasswordForm } from "@/components/change-password-form";
import { NotificationPrefsForm } from "@/components/notification-prefs-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getActivePond } from "@/lib/pond-selection";
import { createClient } from "@/lib/supabase/server";
import { Shield, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function ProfileSettingsPage() {
	const t = await getTranslations("dashboard.profileSettings");

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	const email = user?.email ?? "";
	const displayName = email.split("@")[0] || "User";

	const currentUser = await getCurrentUser();
	const farmId = currentUser?.farmId ?? "\u2014";

	const pond = await getActivePond();
	const notificationPrefs = pond?.notificationPrefs ?? {
		missedFeeding: true,
		deviceOffline: true,
		hopperLow: true,
	};

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<User size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			<div className="space-y-8">
				{/* Profile Information */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<div className="mb-6 border-b border-gray-100 pb-4 dark:border-gray-700/50">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
							<User size={20} />
							{t("profileInfo")}
						</h2>
						<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("profileInfoDesc")}</p>
					</div>

					<div className="grid gap-6 md:grid-cols-2">
						<div className="flex flex-col gap-2">
							<label
								htmlFor="fullName"
								className="text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t("fullName")}
							</label>
							<input
								id="fullName"
								type="text"
								defaultValue={displayName}
								className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<label
								htmlFor="role"
								className="text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t("role")}
							</label>
							<input
								id="role"
								type="text"
								defaultValue={currentUser?.role ?? "\u2014"}
								disabled
								className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<label
								htmlFor="farmId"
								className="text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t("farmId")}
							</label>
							<input
								id="farmId"
								type="text"
								defaultValue={farmId}
								disabled
								className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 font-mono text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<label
								htmlFor="email"
								className="text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{t("email")}
							</label>
							<input
								id="email"
								type="email"
								defaultValue={email}
								disabled
								className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
							/>
						</div>
					</div>

					<div className="mt-6">
						<button
							type="button"
							disabled
							className="flex min-h-[var(--ofd-touch-min)] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white opacity-50 cursor-not-allowed"
						>
							{t("saveChanges")}
						</button>
						<p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t("managedByAdmin")}</p>
					</div>
				</section>

				{/* Security Section */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<div className="mb-6 border-b border-gray-100 pb-4 dark:border-gray-700/50">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
							<Shield size={20} />
							{t("security")}
						</h2>
						<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("securityDesc")}</p>
					</div>

					<ChangePasswordForm />
				</section>

				{/* Notification Preferences */}
				<NotificationPrefsForm
					pondId={pond?.id ?? ""}
					initialPrefs={notificationPrefs}
					canWrite={currentUser?.role === "ADMIN" || currentUser?.role === "OPERATOR"}
				/>
			</div>
		</div>
	);
}
