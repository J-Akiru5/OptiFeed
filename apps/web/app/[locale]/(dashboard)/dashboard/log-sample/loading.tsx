import { FormPageSkeleton } from "@/components/skeletons";
import { getTranslations } from "next-intl/server";

export default async function LogSampleLoading() {
	const t = await getTranslations("dashboard.common");
	return <FormPageSkeleton label={t("loading")} />;
}
