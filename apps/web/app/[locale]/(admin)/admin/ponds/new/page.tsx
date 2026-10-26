import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CreatePondForm } from "@/components/admin/create-pond-form";
import { Link } from "@/i18n/routing";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function NewPondPage() {
	const t = await getTranslations("dashboard.adminCreatePond");

	return (
		<div className="max-w-2xl space-y-6">
			<Link
				href="/admin/ponds"
				className="inline-flex items-center gap-1.5 rounded-lg text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:text-white dark:focus-visible:outline-[#8fc0ea]"
			>
				<ArrowLeft aria-hidden="true" className="h-4 w-4" />
				{t("back")}
			</Link>

			<AdminPageHeader title={t("title")} description={t("desc")} />

			<CreatePondForm />
		</div>
	);
}
