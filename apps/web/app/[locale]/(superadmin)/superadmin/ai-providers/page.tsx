import { AiProviderSettings } from "@/components/superadmin/ai-provider-settings";
import { listAiProviderConfig } from "@/lib/actions/ai-providers";

export default async function SuperadminAiProvidersPage() {
	const providers = await listAiProviderConfig();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">AI Providers</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					The platform-wide model chain used by the chat assistant and feeding predictions. Each
					request tries providers in priority order and falls back on any failure before the first
					token is produced.
				</p>
			</div>

			<div className="bg-[#F4F7F6] rounded-2xl border border-gray-200 p-4">
				<p className="text-xs text-[#3D5568]">
					<strong className="text-[#0A3D62]">Keys stay in the environment.</strong> This console
					stores the <em>name</em> of the variable that holds each provider&apos;s key, never the
					key itself. A provider with no populated variable is skipped automatically, so the chain
					degrades to whatever else is configured — and finally to keyword answers and deterministic
					predictions.
				</p>
			</div>

			<AiProviderSettings providers={providers} />
		</div>
	);
}
