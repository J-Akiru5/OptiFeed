import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { Link } from "@/i18n/routing";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Public 404 boundary (#761).
 *
 * Without this file an unknown URL fell through to Next.js's default English
 * 404 page: no app branding, no locale, and no way back. It sits directly under
 * `app/[locale]`, so the locale layout (and therefore `next-intl`) is already
 * active; the dashboard's own `not-found.tsx` still handles authenticated
 * routes inside its route group.
 */
export default async function NotFound() {
	const [t, tButton] = await Promise.all([getTranslations("errors"), getTranslations("button")]);

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
					<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C2410C] dark:text-[#FF8A5C]">
						404
					</p>
					<h1 className="mt-2 text-2xl font-black tracking-tight text-[#0A3D62] dark:text-white">
						{t("notFoundTitle")}
					</h1>
					<p className="mt-2 text-sm leading-6 text-[#3D5568] dark:text-slate-400">
						{t("notFoundDesc")}
					</p>

					<Link
						href="/"
						className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#C2410C] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B1117]"
					>
						<ArrowLeft className="size-4" aria-hidden="true" />
						{tButton("backToHome")}
					</Link>
				</div>
			</main>
		</div>
	);
}
