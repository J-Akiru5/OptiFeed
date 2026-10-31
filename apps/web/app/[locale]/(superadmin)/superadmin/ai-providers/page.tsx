import { AiProviderSettings } from "@/components/superadmin/ai-provider-settings";
import { Alert, Card, PageHeader } from "@/components/superadmin/ui";
import { listAiProviderConfig } from "@/lib/actions/ai-providers";
import { hasUsableMasterKey } from "@/lib/ai-providers/secret";
import { getTranslations } from "next-intl/server";

export default async function SuperadminAiProvidersPage() {
	const [providers, t] = await Promise.all([
		listAiProviderConfig(),
		getTranslations("superadmin.aiProviders"),
	]);
	const dbKeysEnabled = hasUsableMasterKey();

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />

			{!dbKeysEnabled && (
				<Alert tone="warning">
					<p className="font-bold">{t("dbKeysDisabled")}</p>
					<p className="text-xs">{t("dbKeysDisabledHint")}</p>
				</Alert>
			)}

			<Card className="border-[#0A3D62]/15 bg-[#F4F7F6] p-4">
				<p className="text-xs text-[#3D5568]">
					<strong className="text-[#0A3D62]">{t("keysStay")}</strong>
					{t("storesBefore")}
					<em>{t("storesName")}</em>
					{t("storesAfter")}
				</p>
			</Card>

			<div data-help="superadmin-ai-providers">
				<AiProviderSettings providers={providers} dbKeysEnabled={dbKeysEnabled} />
			</div>
		</div>
	);
}
