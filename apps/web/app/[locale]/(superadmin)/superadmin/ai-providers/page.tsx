import { AiProviderSettings } from "@/components/superadmin/ai-provider-settings";
import { Card, PageHeader } from "@/components/superadmin/ui";
import { listAiProviderConfig } from "@/lib/actions/ai-providers";
import { getTranslations } from "next-intl/server";

export default async function SuperadminAiProvidersPage() {
	const [providers, t] = await Promise.all([
		listAiProviderConfig(),
		getTranslations("superadmin.aiProviders"),
	]);

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />

			<Card className="border-[#0A3D62]/15 bg-[#F4F7F6] dark:bg-[#0B1220] p-4">
				<p className="text-xs text-[#3D5568] dark:text-slate-400">
					<strong className="text-[#0A3D62] dark:text-slate-100">{t("keysStay")}</strong>
					{t("storesBefore")}
					<em>{t("storesName")}</em>
					{t("storesAfter")}
				</p>
			</Card>

			<div data-help="superadmin-ai-providers">
				<AiProviderSettings providers={providers} />
			</div>
		</div>
	);
}
