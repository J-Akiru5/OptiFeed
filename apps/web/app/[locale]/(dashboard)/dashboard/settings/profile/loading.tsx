import { SettingsSkeleton } from "@/components/skeletons";
import { getTranslations } from "next-intl/server";

export default async function ProfileLoading() {
	const t = await getTranslations("dashboard.common");
	return <SettingsSkeleton label={t("loading")} />;
}
