import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { Link } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Landing page for the recovery link (forgot-password → email →
 * `/auth/confirm` → here). The confirmation route exchanges the Supabase
 * token_hash/code and sets the session cookies; this page only has to tell
 * "arrived from the link" apart from "arrived without one": with no session,
 * or no `reset` proof carried by the redirect, the link is invalid or expired
 * and the visitor must request a new one. There is no current-password field
 * because the requester proved control of the mailbox, not the old credential.
 */
export default async function ResetPasswordPage({
	searchParams,
}: {
	searchParams: Promise<{ reset?: string | string[] }>;
}) {
	const [t, params] = await Promise.all([getTranslations("resetPassword"), searchParams]);
	const resetToken =
		typeof params.reset === "string" && params.reset.length > 0 ? params.reset : null;

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

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
					{user && resetToken ? (
						<>
							<h1 className="text-2xl font-black tracking-tight text-[#0A3D62] dark:text-white">
								{t("title")}
							</h1>
							<p className="mt-2 text-sm leading-6 text-[#3D5568] dark:text-slate-400">
								{t("desc")}
							</p>

							<div className="mt-6">
								<ResetPasswordForm resetToken={resetToken} />
							</div>
						</>
					) : (
						<>
							<h1 className="text-2xl font-black tracking-tight text-[#0A3D62] dark:text-white">
								{t("expiredTitle")}
							</h1>
							<p className="mt-2 text-sm leading-6 text-[#3D5568] dark:text-slate-400">
								{t("expiredDesc")}
							</p>

							<Link
								href="/forgot-password"
								className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
							>
								<ArrowLeft className="size-3.5" aria-hidden="true" />
								{t("requestNew")}
							</Link>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
