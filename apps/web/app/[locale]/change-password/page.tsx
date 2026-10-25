import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { ChangePasswordForm } from "@/components/change-password-form";
import { redirect } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { getLocale, getTranslations } from "next-intl/server";

export default async function ChangePasswordPage() {
	const user = await getCurrentUser();

	if (!user) {
		const locale = await getLocale();
		redirect({ href: "/login", locale });
		return null;
	}

	const t = await getTranslations("password");
	const forced = user.mustChangePassword;

	return (
		<div className="flex min-h-[100dvh] flex-col bg-[#F6F8F7] px-4 py-8 dark:bg-[#0B1117]">
			<main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
				<div className="mb-6 flex items-center gap-2.5">
					<OptiFeedLogo size={32} variant="color-light" />
					<span className="text-lg font-black tracking-tight text-[#0A3D62] dark:text-white">
						OptiFeed
					</span>
				</div>

				<div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900 sm:p-8">
					<h1 className="text-2xl font-black tracking-tight text-[#0A3D62] dark:text-white">
						{forced ? t("forcedTitle") : t("title")}
					</h1>
					<p className="mt-2 text-sm leading-6 text-[#3D5568] dark:text-slate-400">
						{forced ? t("forcedDesc") : t("desc")}
					</p>

					<div className="mt-6">
						<ChangePasswordForm forced={forced} />
					</div>
				</div>
			</main>
		</div>
	);
}
