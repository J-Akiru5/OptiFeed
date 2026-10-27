import { CalendarPageSkeleton } from "@/components/skeletons";
import { getTranslations } from "next-intl/server";

export default async function HarvestLoading() {
	const t = await getTranslations("dashboard.common");
	return <CalendarPageSkeleton label={t("loading")} />;
}
