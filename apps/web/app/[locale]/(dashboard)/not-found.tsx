import { Link } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
	const t = await getTranslations("errors");

	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4">
			<h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t("notFoundTitle")}</h2>
			<p className="text-gray-500 dark:text-gray-400">{t("notFoundDesc")}</p>
			<Link
				href="/dashboard"
				className="rounded-lg bg-[#E85A2A] px-6 py-2 font-medium text-white hover:opacity-90"
			>
				{t("backToDashboard")}
			</Link>
		</div>
	);
}
