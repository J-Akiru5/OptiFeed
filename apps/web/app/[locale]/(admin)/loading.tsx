import { getTranslations } from "next-intl/server";

const SKELETON_CARDS = ["c1", "c2", "c3"];

export default async function AdminLoading() {
	const t = await getTranslations("dashboard.adminCommon");

	return (
		<output className="block space-y-6">
			<span className="sr-only">{t("loading")}</span>
			<div className="space-y-2">
				<div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
				<div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				{SKELETON_CARDS.map((card) => (
					<div key={card} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
				))}
			</div>
			<div className="h-72 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
		</output>
	);
}
