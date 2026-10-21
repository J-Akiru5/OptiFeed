import { DataExportButton, DataImportDialog } from "@/components/DataImportExport";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { ChevronLeft, Database, Download, Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function DataSettingsPage() {
	const t = await getTranslations("dashboard.dataSettings");
	const writeAccess = await canWrite();

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<Link
					href="/dashboard/settings"
					className="inline-flex items-center gap-1 text-sm font-bold text-[#3D5568] dark:text-gray-400 hover:text-[#0A3D62] dark:hover:text-[#5b9bd5] transition-colors mb-4"
				>
					<ChevronLeft className="w-4 h-4" /> {t("backToSettings")}
				</Link>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Database size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-700/60">
					<div className="flex items-center gap-3 mb-4">
						<div className="w-12 h-12 rounded-2xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
							<Download className="w-6 h-6 text-green-600 dark:text-green-400" />
						</div>
						<div>
							<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("exportTitle")}
							</h2>
							<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("exportDesc")}</p>
						</div>
					</div>
					<p className="text-sm text-[#3D5568] dark:text-gray-400 mb-4">{t("exportBody")}</p>
					<DataExportButton />
				</div>

				<div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 dark:bg-gray-900 dark:border-gray-700/60">
					<div className="flex items-center gap-3 mb-4">
						<div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
							<Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#5b9bd5]">
								{t("importTitle")}
							</h2>
							<p className="text-xs text-[#3D5568] dark:text-gray-400">{t("importDesc")}</p>
						</div>
					</div>
					<p className="text-sm text-[#3D5568] dark:text-gray-400 mb-4">{t("importBody")}</p>
					<DataImportDialog canWrite={writeAccess} />
				</div>
			</div>
		</div>
	);
}
