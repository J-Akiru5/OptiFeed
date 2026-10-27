import { PlatformListSettings } from "@/components/superadmin/platform-settings";
import { PageHeader } from "@/components/superadmin/ui";
import {
	LIST_PAGE_SIZE_DEFAULT,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_MIN,
	getListPageSize,
} from "@/lib/settings/platform";
import { getTranslations } from "next-intl/server";

export default async function SuperadminSettingsPage() {
	const [pageSize, t] = await Promise.all([
		getListPageSize(),
		getTranslations("superadmin.settings"),
	]);

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />
			<PlatformListSettings
				initialPageSize={pageSize}
				min={LIST_PAGE_SIZE_MIN}
				max={LIST_PAGE_SIZE_MAX}
				fallback={LIST_PAGE_SIZE_DEFAULT}
			/>
		</div>
	);
}
