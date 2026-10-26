"use client";

import {
	Alert,
	Badge,
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import type { AiProviderView } from "@/lib/actions/ai-providers";
import { resetAiProviderConfig, saveAiProviderConfig } from "@/lib/actions/ai-providers";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, RotateCcw, Save, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

const EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;

function ProviderCard({ provider }: { provider: AiProviderView }) {
	const t = useTranslations("superadmin.aiProviders");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [enabled, setEnabled] = useState(provider.enabled);
	const [priority, setPriority] = useState(String(provider.priority));
	const [model, setModel] = useState(provider.model);
	const [apiKeyEnv, setApiKeyEnv] = useState(provider.apiKeyEnv);
	const [reasoningEffort, setReasoningEffort] = useState(provider.reasoningEffort);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setSaved(false);

		if (reason.trim().length < 10) {
			setError(tCommon("reasonMinLength", { count: 10 }));
			return;
		}

		startTransition(async () => {
			const result = await saveAiProviderConfig({
				provider: provider.provider,
				enabled,
				priority: Number(priority),
				model,
				apiKeyEnv,
				reasoningEffort,
				reason: reason.trim(),
			});
			if (result.error) {
				setError(result.error);
				return;
			}
			setReason("");
			setSaved(true);
			router.refresh();
			setTimeout(() => setSaved(false), 2500);
		});
	};

	return (
		<form onSubmit={handleSubmit} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62]">{provider.label}</h2>
					<p className="text-[11px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{provider.provider}
						{provider.configured ? "" : t("usingDefault")}
					</p>
				</div>
				<Badge
					tone={provider.apiKeyPresent ? "success" : "warning"}
					icon={provider.apiKeyPresent ? CheckCircle2 : XCircle}
				>
					{provider.apiKeyPresent ? t("keyDetected") : t("noKey")}
				</Badge>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-model`} className={FIELD_LABEL}>
						{t("model")}
					</label>
					<input
						id={`${provider.provider}-model`}
						type="text"
						value={model}
						onChange={(e) => setModel(e.target.value)}
						disabled={isPending}
						placeholder={provider.model}
						className={FIELD_INPUT}
					/>
				</div>

				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-priority`} className={FIELD_LABEL}>
						{t("priority")}
					</label>
					<input
						id={`${provider.provider}-priority`}
						type="number"
						min={0}
						max={1000}
						value={priority}
						onChange={(e) => setPriority(e.target.value)}
						disabled={isPending}
						className={FIELD_INPUT}
					/>
				</div>

				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-env`} className={FIELD_LABEL}>
						{t("apiKeyEnv")}
					</label>
					<input
						id={`${provider.provider}-env`}
						type="text"
						value={apiKeyEnv}
						onChange={(e) => setApiKeyEnv(e.target.value)}
						disabled={isPending}
						placeholder={provider.apiKeyEnv}
						aria-describedby={`${provider.provider}-env-hint`}
						className={FIELD_INPUT}
					/>
					<p id={`${provider.provider}-env-hint`} className={FIELD_HINT}>
						{t("envHintBefore")} <code>{provider.apiKeyEnv}</code>
						{t("envHintAfter")}
					</p>
				</div>

				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-effort`} className={FIELD_LABEL}>
						{t("effort")}
					</label>
					<select
						id={`${provider.provider}-effort`}
						value={reasoningEffort}
						onChange={(e) => setReasoningEffort(e.target.value as typeof reasoningEffort)}
						disabled={isPending}
						className={FIELD_INPUT}
					>
						{EFFORT_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{t(`effortOptions.${option}`)}
							</option>
						))}
					</select>
					<p className={FIELD_HINT}>{t("effortHint")}</p>
				</div>
			</div>

			<label className="flex items-center gap-2.5 text-sm font-bold text-[#0A3D62]">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
					disabled={isPending}
					className="h-4 w-4 rounded border-gray-300 text-[#E85A2A] focus:ring-[#E85A2A]"
				/>
				{t("enabled")}
			</label>

			<div className="space-y-1.5">
				<label htmlFor={`${provider.provider}-reason`} className={FIELD_LABEL}>
					{tCommon("reasonRequired")}
				</label>
				<input
					id={`${provider.provider}-reason`}
					type="text"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={t("reasonPlaceholder")}
					aria-describedby={`${provider.provider}-reason-hint`}
					className={FIELD_INPUT}
				/>
				<p id={`${provider.provider}-reason-hint`} className={FIELD_HINT}>
					{t("reasonHint")}
				</p>
			</div>

			{error && <Alert tone="error">{error}</Alert>}

			{saved && <Alert tone="success">{t("saved")}</Alert>}

			<button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
				{isPending ? (
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				) : (
					<Save className="h-4 w-4" aria-hidden="true" />
				)}
				{t("save", { label: provider.label })}
			</button>
		</form>
	);
}

export function AiProviderSettings({ providers }: { providers: AiProviderView[] }) {
	const t = useTranslations("superadmin.aiProviders");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [reset, setReset] = useState(false);

	const handleReset = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (reason.trim().length < 10) {
			setError(tCommon("reasonMinLength", { count: 10 }));
			return;
		}

		startTransition(async () => {
			const result = await resetAiProviderConfig(reason.trim());
			if (result.error) {
				setError(result.error);
				return;
			}
			setReason("");
			setReset(true);
			router.refresh();
			setTimeout(() => setReset(false), 2500);
		});
	};

	return (
		<div className="space-y-6">
			{providers.map((provider) => (
				<ProviderCard key={provider.provider} provider={provider} />
			))}

			<form onSubmit={handleReset} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
				<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568]">
					{t("resetTitle")}
				</h2>
				<p className="text-sm text-[#3D5568]">{t("resetDesc")}</p>

				<div className="space-y-1.5">
					<label htmlFor="ai-provider-reset-reason" className={FIELD_LABEL}>
						{tCommon("reasonRequired")}
					</label>
					<input
						id="ai-provider-reset-reason"
						type="text"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						disabled={isPending}
						placeholder={t("resetReasonPlaceholder")}
						className={FIELD_INPUT}
					/>
				</div>

				{error && <Alert tone="error">{error}</Alert>}

				{reset && <Alert tone="success">{t("resetDone")}</Alert>}

				<button
					type="submit"
					disabled={isPending}
					className="inline-flex items-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#082f4d] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2"
				>
					{isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
					) : (
						<RotateCcw className="h-4 w-4" aria-hidden="true" />
					)}
					{t("reset")}
				</button>
			</form>
		</div>
	);
}
