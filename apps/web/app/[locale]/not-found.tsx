import { Link } from "@/i18n/routing";
import { Home } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Branded, localized 404 for every public path (#761).
 *
 * Unknown URLs used to fall through to the default Next.js English page with no
 * branding and no way back. This boundary lives under `[locale]`, so the copy
 * follows the active locale and the home link keeps it. Next only honours a
 * metadata export on the root/global not-found file, so the layout's title stays.
 */
export default async function LocaleNotFound() {
	const t = await getTranslations("errors");

	return (
		<main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#F7F9F8] px-6 py-16 text-center font-sans text-[#0A2E47] dark:bg-[#060C11] dark:text-white">
			<p className="text-[11px] font-black uppercase tracking-[0.28em] text-[#C2410C] dark:text-[#FF8A5C]">
				404
			</p>
			<h1 className="mt-3 max-w-xl text-balance text-3xl font-black tracking-tight sm:text-4xl">
				{t("notFoundTitle")}
			</h1>
			<p className="mt-3 max-w-md text-sm leading-relaxed text-[#3D5568] dark:text-gray-300">
				{t("notFoundDesc")}
			</p>
			<Link
				href="/"
				className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--ofd-cta)] px-6 text-sm font-bold text-white transition-colors hover:bg-[var(--ofd-cta-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:ring-offset-2 dark:focus-visible:ring-[#8fc0ea] dark:focus-visible:ring-offset-[#060C11]"
			>
				<Home aria-hidden="true" className="size-4" />
				{t("backToHome")}
			</Link>
		</main>
	);
}
