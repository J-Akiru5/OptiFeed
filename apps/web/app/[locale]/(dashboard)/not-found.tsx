import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
	const t = await getTranslations("errors");

	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
			<h2 className="text-2xl font-bold text-[#0A3D62] dark:text-gray-100">{t("notFoundTitle")}</h2>
			<p className="text-gray-600 dark:text-gray-400">{t("notFoundDesc")}</p>
			<Link
				href="/dashboard"
				className="inline-flex min-h-11 items-center rounded-xl bg-[#C2410C] px-6 py-2 text-sm font-bold text-white transition hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
			>
				{t("backToDashboard")}
			</Link>
		</div>
	);
}
