import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import {
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { dashboardSectionLink } from "@/components/dashboard/dashboard-ui";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { ChevronLeft, Database, Download, Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function DataSettingsPage() {
	const [t, tCommon] = await Promise.all([
		getTranslations("dashboard.dataSettings"),
		getTranslations("dashboard.common"),
	]);
	const writeAccess = await canWrite();

	return (
		<div className="w-full space-y-6 pb-20">
			<div>
				<Link
					href="/dashboard/settings"
					className={cn(
						"-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 px-1",
						dashboardSectionLink,
					)}
				>
					<ChevronLeft aria-hidden="true" className="h-4 w-4" /> {t("backToSettings")}
				</Link>
				<DashboardPageHeader title={t("title")} description={t("desc")} icon={Database} />
			</div>

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			<div className="grid gap-4 md:grid-cols-2">
				<DashboardSection title={t("exportTitle")} description={t("exportDesc")} icon={Download}>
					<p className="mb-4 text-sm text-[#3D5568] dark:text-gray-300">{t("exportBody")}</p>
					<DataExportButton />
				</DashboardSection>

				<DashboardSection title={t("importTitle")} description={t("importDesc")} icon={Upload}>
					<p className="mb-4 text-sm text-[#3D5568] dark:text-gray-300">{t("importBody")}</p>
					<DataImportDialog canWrite={writeAccess} />
				</DashboardSection>
			</div>
		</div>
	);
}
