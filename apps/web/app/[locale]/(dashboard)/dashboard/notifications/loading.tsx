import { ListPageSkeleton } from "@/components/skeletons";
import { getTranslations } from "next-intl/server";

export default async function NotificationsLoading() {
	const t = await getTranslations("dashboard.common");
	return <ListPageSkeleton label={t("loading")} />;
}
