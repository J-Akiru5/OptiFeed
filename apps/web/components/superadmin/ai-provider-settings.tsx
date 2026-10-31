"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	Alert,
	Badge,
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import type { AiProviderActionResult, AiProviderView } from "@/lib/actions/ai-providers";
import {
	clearProviderKey,
	resetAiProviderConfig,
	saveAiProviderConfig,
	setProviderKey,
	testProviderKey,
} from "@/lib/actions/ai-providers";
import { cn } from "@/lib/utils";
import {
	CheckCircle2,
	Database,
	KeyRound,
	Loader2,
	RotateCcw,
	Save,
	Trash2,
	XCircle,
	Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

const EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;

const SECONDARY_BUTTON =
	"inline-flex items-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-4 py-2.5 text-sm font-bold text-[#0A3D62] shadow-sm transition-colors hover:bg-[#F4F7F6] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10";

/** Deterministic date text: rendering must not differ between server and client. */
function formatUpdated(iso: string): string {
	return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function ProviderCard({
	provider,
	dbKeysEnabled,
}: {
	provider: AiProviderView;
	dbKeysEnabled: boolean;
}) {
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

	const [keyPending, startKeyTransition] = useTransition();
	const [keyValue, setKeyValue] = useState("");
	const [keyReason, setKeyReason] = useState("");
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keySaved, setKeySaved] = useState<string | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);

	const sourceLabel =
		provider.key.source === "db"
			? t("sourceDb")
			: provider.key.source === "env"
				? t("sourceEnv")
				: t("sourceNone");
	const sourceTone =
		provider.key.source === "db" ? "success" : provider.key.source === "env" ? "brand" : "warning";
	const SourceIcon =
		provider.key.source === "db" ? Database : provider.key.source === "env" ? KeyRound : XCircle;

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

	const runKeyAction = (
		stepUpLabel: string,
		action: () => Promise<AiProviderActionResult>,
		onSuccess: (result: AiProviderActionResult) => void,
		clearError = true,
	) => {
		if (clearError) setKeyError(null);
		setKeySaved(null);
		startKeyTransition(async () => {
			try {
				const result = await action();
				if (result.code === "step_up_required") {
					retryRef.current = () => runKeyAction(stepUpLabel, action, onSuccess, false);
					setStepUpOpen(true);
					return;
				}
				if (result.error) {
					setKeyError(result.error);
					return;
				}
				onSuccess(result);
				router.refresh();
			} catch (err) {
				setKeyError(err instanceof Error ? err.message : t("keyTestFailed", { error: "unknown" }));
			}
		});
	};

	const submitKey = (e: FormEvent) => {
		e.preventDefault();
		setKeyError(null);
		setKeySaved(null);

		if (keyReason.trim().length < 10) {
			setKeyError(tCommon("reasonMinLength", { count: 10 }));
			return;
		}

		const value = keyValue.trim();
		if (!value) {
			setKeyError(t("keyInput"));
			return;
		}

		// The value is taken from the form state into this closure and the field
		// is cleared immediately. A step-up retry reuses the closure, so the
		// secret never sits in a persisted value or a second render.
		setKeyValue("");
		const reason = keyReason.trim();
		runKeyAction(
			t("keyStepUpAction", { provider: provider.label }),
			() => setProviderKey({ provider: provider.provider, key: value, reason }),
			() => {
				setKeyReason("");
				setKeySaved(t("keySetDone"));
			},
		);
	};

	const clearKey = () => {
		if (keyReason.trim().length < 10) {
			setKeyError(tCommon("reasonMinLength", { count: 10 }));
			return;
		}
		const reason = keyReason.trim();
		runKeyAction(
			t("keyStepUpAction", { provider: provider.label }),
			() => clearProviderKey({ provider: provider.provider, reason }),
			() => {
				setKeyReason("");
				setKeySaved(t("keyClearedDone"));
			},
		);
	};

	const testKey = () => {
		if (keyReason.trim().length < 10) {
			setKeyError(tCommon("reasonMinLength", { count: 10 }));
			return;
		}
		const reason = keyReason.trim();
		runKeyAction(
			t("testKey"),
			() => testProviderKey({ provider: provider.provider, reason }),
			(result) => setKeySaved(t("keyTestOk", { latency: result.latencyMs ?? 0 })),
		);
	};

	return (
		<div className={cn(CARD, "space-y-4 p-6")}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-black text-[#0A3D62]">{provider.label}</h2>
					<p className="text-[11px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						{provider.provider}
						{provider.configured ? "" : t("usingDefault")}
					</p>
				</div>
				<Badge tone={sourceTone} icon={SourceIcon}>
					{sourceLabel}
				</Badge>
			</div>

			<form onSubmit={handleSubmit} className="space-y-4" aria-busy={isPending}>
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

			<form
				onSubmit={submitKey}
				className="space-y-3 rounded-2xl border border-[#0A3D62]/15 bg-[#F4F7F6] p-4"
				aria-busy={keyPending}
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568]">
						{t("keySource")}
					</h3>
					<Badge tone={sourceTone} icon={SourceIcon}>
						{sourceLabel}
					</Badge>
				</div>

				{provider.key.source === "db" && (
					<div className="space-y-1 text-sm text-[#3D5568]">
						{provider.key.last4 && (
							<p className="font-mono text-base font-black tracking-widest text-[#0A3D62]">
								{t("keyLast4", { last4: provider.key.last4 })}
							</p>
						)}
						{provider.key.updatedAt ? (
							<p className="text-xs">
								{t("keyUpdated", { date: formatUpdated(provider.key.updatedAt) })}
								{provider.key.updatedBy
									? ` ${t("keyUpdatedBy", { user: provider.key.updatedBy })}`
									: ""}
							</p>
						) : (
							<p className="text-xs">{t("keyNeverUpdated")}</p>
						)}
					</div>
				)}

				{!dbKeysEnabled && (
					<Alert tone="warning">
						<p className="font-bold">{t("dbKeysDisabled")}</p>
						<p className="text-xs">{t("dbKeysDisabledHint")}</p>
					</Alert>
				)}

				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-key`} className={FIELD_LABEL}>
						{t("keyInput")}
					</label>
					<input
						id={`${provider.provider}-key`}
						type="password"
						value={keyValue}
						onChange={(e) => setKeyValue(e.target.value)}
						disabled={keyPending || !dbKeysEnabled}
						autoComplete="off"
						placeholder={t("keyPlaceholder")}
						aria-describedby={`${provider.provider}-key-hint`}
						className={FIELD_INPUT}
					/>
					<p id={`${provider.provider}-key-hint`} className={FIELD_HINT}>
						{t("keyInputHint")}
					</p>
				</div>

				<div className="space-y-1.5">
					<label htmlFor={`${provider.provider}-key-reason`} className={FIELD_LABEL}>
						{tCommon("reasonRequired")}
					</label>
					<input
						id={`${provider.provider}-key-reason`}
						type="text"
						value={keyReason}
						onChange={(e) => setKeyReason(e.target.value)}
						disabled={keyPending}
						placeholder={t("reasonPlaceholder")}
						aria-describedby={`${provider.provider}-key-reason-hint`}
						className={FIELD_INPUT}
					/>
					<p id={`${provider.provider}-key-reason-hint`} className={FIELD_HINT}>
						{t("keyReasonHint")}
					</p>
				</div>

				<p className={FIELD_HINT}>{t("keySetHint")}</p>

				{keyError && <Alert tone="error">{keyError}</Alert>}
				{keySaved && <Alert tone="success">{keySaved}</Alert>}

				<div className="flex flex-wrap gap-2">
					<button type="submit" disabled={keyPending || !dbKeysEnabled} className={PRIMARY_BUTTON}>
						{keyPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<KeyRound className="h-4 w-4" aria-hidden="true" />
						)}
						{provider.key.source === "db" ? t("rotateKey") : t("setKey")}
					</button>

					<button
						type="button"
						onClick={clearKey}
						disabled={keyPending || provider.key.source !== "db"}
						className={SECONDARY_BUTTON}
					>
						<Trash2 className="h-4 w-4" aria-hidden="true" />
						{t("clearKey")}
					</button>

					<button
						type="button"
						onClick={testKey}
						disabled={keyPending || provider.key.source === "none"}
						className={SECONDARY_BUTTON}
					>
						<Zap className="h-4 w-4" aria-hidden="true" />
						{t("testKey")}
					</button>
				</div>
				<p className={FIELD_HINT}>{t("keyTestHint")}</p>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("keyStepUpAction", { provider: provider.label })}
				onClose={() => {
					setStepUpOpen(false);
					retryRef.current = null;
				}}
				onVerified={() => {
					setStepUpOpen(false);
					const retry = retryRef.current;
					retryRef.current = null;
					retry?.();
				}}
			/>
		</div>
	);
}

export function AiProviderSettings({
	providers,
	dbKeysEnabled,
}: {
	providers: AiProviderView[];
	dbKeysEnabled: boolean;
}) {
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
				<ProviderCard key={provider.provider} provider={provider} dbKeysEnabled={dbKeysEnabled} />
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

				<button type="submit" disabled={isPending} className={SECONDARY_BUTTON}>
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
