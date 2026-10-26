import { AiProviderSettings } from "@/components/superadmin/ai-provider-settings";
import { Card, PageHeader } from "@/components/superadmin/ui";
import { listAiProviderConfig } from "@/lib/actions/ai-providers";

export default async function SuperadminAiProvidersPage() {
	const providers = await listAiProviderConfig();

	return (
		<div className="space-y-6">
			<PageHeader
				title="AI Providers"
				description="The platform-wide model chain used by the chat assistant and feeding predictions. Each request tries providers in priority order and falls back on any failure before the first token is produced."
			/>

			<Card className="border-[#0A3D62]/15 bg-[#F4F7F6] p-4">
				<p className="text-xs text-[#3D5568]">
					<strong className="text-[#0A3D62]">Keys stay in the environment.</strong> This console
					stores the <em>name</em> of the variable that holds each provider&apos;s key, never the
					key itself. A provider with no populated variable is skipped automatically, so the chain
					degrades to whatever else is configured — and finally to keyword answers and deterministic
					predictions.
				</p>
			</Card>

			<AiProviderSettings providers={providers} />
		</div>
	);
}
