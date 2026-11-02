"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	Alert,
	Badge,
	CARD,
	DANGER_BUTTON,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import type { AiProviderView } from "@/lib/actions/ai-providers";
import {
	clearAiProviderKey,
	createAiProvider,
	removeAiProvider,
	resetAiProviderConfig,
	saveAiProviderConfig,
	setAiProviderKey,
} from "@/lib/actions/ai-providers";
import { cn } from "@/lib/utils";
import {
	CheckCircle2,
	KeyRound,
	Loader2,
	Plus,
	RotateCcw,
	Save,
	ShieldAlert,
	Trash2,
	XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";

const EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;
const MIN_REASON = 10;

function formatDate(iso: string | null, locale: string): string {
	if (!iso) return "";
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
			new Date(iso),
		);
	} catch {
		return iso;
	}
}

function ProviderCard({ provider }: { provider: AiProviderView }) {
	const t = useTranslations("superadmin.aiProviders");
	const tCommon = useTranslations("superadmin.common");
	const locale = useLocale();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [enabled, setEnabled] = useState(provider.enabled);
	const [priority, setPriority] = useState(String(provider.priority));
	const [model, setModel] = useState(provider.model);
	const [apiKeyEnv, setApiKeyEnv] = useState(provider.apiKeyEnv);
	const [label, setLabel] = useState(provider.label);
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(provider.reasoningEffort);
	const [reason, setReason] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [keyNotice, setKeyNotice] = useState<string | null>(null);
	const [stepUp, setStepUp] = useState<{ label: string; retry: (() => void) | null } | null>(null);

	const handleStepUpAware = (
		label: string,
		run: () => Promise<{ error?: string; code?: "step_up_required"; success?: boolean }>,
	) => {
		startTransition(async () => {
			const result = await run();
			if (result.error) {
				if (result.code === "step_up_required") {
					setStepUp({ label, retry: () => handleStepUpAware(label, run) });
					return;
				}
				setError(result.error);
				return;
			}
			setError(null);
			router.refresh();
		});
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setSaved(false);
		setKeyNotice(null);

		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}

		startTransition(async () => {
			const result = await saveAiProviderConfig({
				provider: provider.provider,
				enabled,
				priority: Number(priority),
				model,
				apiKeyEnv,
				label: provider.builtIn ? undefined : label,
				baseUrl: provider.builtIn ? undefined : baseUrl,
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

	const handleSaveKey = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setKeyNotice(null);

		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		if (apiKey.trim().length < 8) {
			setError(t("keyTooShort"));
			return;
		}

		handleStepUpAware(t("rotateKeyLabel", { label: provider.label }), async () => {
			const result = await setAiProviderKey({
				provider: provider.provider,
				apiKey: apiKey.trim(),
				reason: reason.trim(),
			});
			if (result.success) {
				setApiKey("");
				setKeyNotice(t("keySavedTested", { ms: result.latencyMs ?? 0 }));
			}
			return result;
		});
	};

	const handleClearKey = () => {
		setError(null);
		setKeyNotice(null);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		handleStepUpAware(t("clearKeyLabel", { label: provider.label }), async () => {
			const result = await clearAiProviderKey(provider.provider, reason.trim());
			if (result.success) setKeyNotice(t("keyCleared"));
			return result;
		});
	};

	const handleRemove = () => {
		setError(null);
		setKeyNotice(null);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		handleStepUpAware(t("removeLabel", { label: provider.label }), async () => {
			const result = await removeAiProvider(provider.provider, reason.trim());
			return result;
		});
	};

	const keyTone =
		provider.keyUnreadable || provider.keySource === "none"
			? provider.keyUnreadable
				? "danger"
				: "warning"
			: "success";
	const keyIcon = provider.keyUnreadable
		? ShieldAlert
		: provider.keySource === "none"
			? XCircle
			: CheckCircle2;

	return (
		<form onSubmit={handleSubmit} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
			<StepUpDialog
				open={Boolean(stepUp)}
				actionLabel={stepUp?.label ?? ""}
				onClose={() => setStepUp(null)}
				onVerified={() => {
					const retry = stepUp?.retry;
					setStepUp(null);
					retry?.();
				}}
			/>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">
						{provider.label}
					</h2>
					<p className="text-[11px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
						{provider.provider} · {provider.kind}
						{provider.builtIn ? "" : ` · ${t("custom")}`}
						{provider.configured ? "" : t("usingDefault")}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge tone={keyTone} icon={keyIcon}>
						{provider.keyUnreadable
							? t("keyUnreadable")
							: provider.keySource === "db"
								? t("keyInDb", { last4: provider.keyLast4 ?? "****" })
								: provider.keySource === "env"
									? t("keyFromEnv")
									: t("noKey")}
					</Badge>
					{!provider.builtIn && (
						<button
							type="button"
							onClick={handleRemove}
							disabled={isPending}
							className={DANGER_BUTTON}
						>
							<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
							{t("remove")}
						</button>
					)}
				</div>
			</div>

			{provider.keyUnreadable && <Alert tone="error">{t("keyUnreadableHelp")}</Alert>}

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

				{!provider.builtIn && (
					<>
						<div className="space-y-1.5">
							<label htmlFor={`${provider.provider}-label`} className={FIELD_LABEL}>
								{t("label")}
							</label>
							<input
								id={`${provider.provider}-label`}
								type="text"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								disabled={isPending}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${provider.provider}-base-url`} className={FIELD_LABEL}>
								{t("baseUrl")}
							</label>
							<input
								id={`${provider.provider}-base-url`}
								type="url"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								disabled={isPending}
								placeholder={t("baseUrlPlaceholder")}
								className={FIELD_INPUT}
							/>
							<p className={FIELD_HINT}>{t("baseUrlHint")}</p>
						</div>
					</>
				)}

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

			<label className="flex items-center gap-2.5 text-sm font-bold text-[#0A3D62] dark:text-slate-100">
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
			{keyNotice && <Alert tone="success">{keyNotice}</Alert>}

			<div className="flex flex-wrap items-center gap-3">
				<button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
					{isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
					) : (
						<Save className="h-4 w-4" aria-hidden="true" />
					)}
					{t("save", { label: provider.label })}
				</button>
			</div>

			{/* Key material is managed separately from the chain settings: it has
			    its own step-up and its own audit action. */}
			<div className="space-y-3 rounded-xl border border-[#0A3D62]/15 bg-[#F4F7F6] dark:bg-[#0B1220] p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#0A3D62] dark:text-slate-100">
						<KeyRound className="h-4 w-4" aria-hidden="true" />
						{t("apiKey")}
					</p>
					<p className="text-[11px] text-[#3D5568] dark:text-slate-400">
						{provider.keySource === "db"
							? t("keyMeta", {
									last4: provider.keyLast4 ?? "****",
									when: formatDate(provider.keyUpdatedAt, locale),
									who: provider.keyUpdatedBy ?? t("unknownActor"),
								})
							: provider.keySource === "env"
								? t("envKeyMeta", { env: provider.apiKeyEnv })
								: t("noKeyMeta")}
					</p>
				</div>

				<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="min-w-0 flex-1 space-y-1.5">
						<label htmlFor={`${provider.provider}-key`} className={FIELD_LABEL}>
							{provider.keySource === "db" ? t("rotateKey") : t("setKey")}
						</label>
						<input
							id={`${provider.provider}-key`}
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							disabled={isPending}
							autoComplete="new-password"
							placeholder={t("keyPlaceholder")}
							aria-describedby={`${provider.provider}-key-hint`}
							className={FIELD_INPUT}
						/>
						<p id={`${provider.provider}-key-hint`} className={FIELD_HINT}>
							{t("keyHint")}
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleSaveKey}
							disabled={isPending || apiKey.trim().length === 0}
							className={PRIMARY_BUTTON}
						>
							{isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							) : (
								<KeyRound className="h-4 w-4" aria-hidden="true" />
							)}
							{t("saveKey")}
						</button>
						{provider.keySource === "db" && (
							<button
								type="button"
								onClick={handleClearKey}
								disabled={isPending}
								className={SECONDARY_BUTTON}
							>
								{t("clearKey")}
							</button>
						)}
					</div>
				</div>
			</div>
		</form>
	);
}

function AddProviderForm() {
	const t = useTranslations("superadmin.aiProviders");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [slug, setSlug] = useState("");
	const [label, setLabel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("");
	const [priority, setPriority] = useState("100");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState(false);
	const slugId = useId();

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setCreated(false);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		startTransition(async () => {
			const result = await createAiProvider({
				provider: slug,
				label,
				baseUrl,
				model,
				priority: Number(priority),
				reason: reason.trim(),
			});
			if (result.error) {
				setError(result.error);
				return;
			}
			setSlug("");
			setLabel("");
			setBaseUrl("");
			setModel("");
			setPriority("100");
			setReason("");
			setCreated(true);
			router.refresh();
			setTimeout(() => setCreated(false), 2500);
		});
	};

	return (
		<form onSubmit={submit} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
						{t("addTitle")}
					</h2>
					<p className="mt-1 text-sm text-[#3D5568] dark:text-slate-400">{t("addDesc")}</p>
				</div>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className={SECONDARY_BUTTON}
					aria-expanded={open}
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
					{open ? tCommon("cancel") : t("addToggle")}
				</button>
			</div>

			{open && (
				<>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor={slugId} className={FIELD_LABEL}>
								{t("providerId")}
							</label>
							<input
								id={slugId}
								type="text"
								value={slug}
								onChange={(e) => setSlug(e.target.value)}
								placeholder={t("providerIdPlaceholder")}
								disabled={isPending}
								className={FIELD_INPUT}
							/>
							<p className={FIELD_HINT}>{t("providerIdHint")}</p>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${slugId}-label`} className={FIELD_LABEL}>
								{t("label")}
							</label>
							<input
								id={`${slugId}-label`}
								type="text"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder={t("labelPlaceholder")}
								disabled={isPending}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${slugId}-url`} className={FIELD_LABEL}>
								{t("baseUrl")}
							</label>
							<input
								id={`${slugId}-url`}
								type="url"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder={t("baseUrlPlaceholder")}
								disabled={isPending}
								className={FIELD_INPUT}
							/>
							<p className={FIELD_HINT}>{t("baseUrlHint")}</p>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${slugId}-model`} className={FIELD_LABEL}>
								{t("model")}
							</label>
							<input
								id={`${slugId}-model`}
								type="text"
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder={t("modelPlaceholder")}
								disabled={isPending}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor={`${slugId}-priority`} className={FIELD_LABEL}>
								{t("priority")}
							</label>
							<input
								id={`${slugId}-priority`}
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
							<label htmlFor={`${slugId}-reason`} className={FIELD_LABEL}>
								{tCommon("reasonRequired")}
							</label>
							<input
								id={`${slugId}-reason`}
								type="text"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								disabled={isPending}
								placeholder={t("reasonPlaceholder")}
								className={FIELD_INPUT}
							/>
						</div>
					</div>

					{error && <Alert tone="error">{error}</Alert>}
					{created && <Alert tone="success">{t("addDone")}</Alert>}

					<button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
						{isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<Plus className="h-4 w-4" aria-hidden="true" />
						)}
						{t("addSubmit")}
					</button>
				</>
			)}
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
	const [stepUp, setStepUp] = useState<{ label: string; retry: (() => void) | null } | null>(null);

	const runReset = (trimmedReason: string) => {
		startTransition(async () => {
			const result = await resetAiProviderConfig(trimmedReason);
			if (result.error) {
				if (result.code === "step_up_required") {
					setStepUp({
						label: t("resetLabel"),
						retry: () => runReset(trimmedReason),
					});
					return;
				}
				setError(result.error);
				return;
			}
			setReason("");
			setReset(true);
			router.refresh();
			setTimeout(() => setReset(false), 2500);
		});
	};

	const handleReset = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
			return;
		}
		runReset(reason.trim());
	};

	return (
		<div className="space-y-6">
			<StepUpDialog
				open={Boolean(stepUp)}
				actionLabel={stepUp?.label ?? ""}
				onClose={() => setStepUp(null)}
				onVerified={() => {
					const retry = stepUp?.retry;
					setStepUp(null);
					retry?.();
				}}
			/>

			{providers.map((provider) => (
				<ProviderCard key={provider.provider} provider={provider} />
			))}

			<AddProviderForm />

			<form onSubmit={handleReset} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
				<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
					{t("resetTitle")}
				</h2>
				<p className="text-sm text-[#3D5568] dark:text-slate-400">{t("resetDesc")}</p>

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
