import { getTranslations } from "next-intl/server";

const SKELETON_CARDS = ["c1", "c2", "c3", "c4"];

const block =
	"animate-pulse rounded-2xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] motion-reduce:animate-none";

/**
 * Route-level skeleton for the platform console. It mirrors the real overview
 * layout (title, four stat cards, one table card) so the first paint does not
 * jump when the page arrives, and it stays on the console's light palette.
 */
export default async function SuperadminLoading() {
	const t = await getTranslations("superadmin.loading");

	return (
		<div className="space-y-6" aria-busy="true">
			<output className="sr-only">{t("message")}</output>

			<div className="space-y-2">
				<div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-gray-200 motion-reduce:animate-none" />
				<div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-200 motion-reduce:animate-none" />
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{SKELETON_CARDS.map((card) => (
					<div key={card} className={`${block} h-28`} />
				))}
			</div>

			<div className={`${block} h-72`} />
		</div>
	);
}
