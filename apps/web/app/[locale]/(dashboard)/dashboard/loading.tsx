import { DashboardSkeleton } from "@/components/skeletons";
import { getTranslations } from "next-intl/server";

export default async function DashboardLoading() {
	const t = await getTranslations("dashboard.common");
	return <DashboardSkeleton label={t("loading")} />;
}
