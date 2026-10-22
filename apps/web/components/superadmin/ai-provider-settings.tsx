"use client";

import type { AiProviderView } from "@/lib/actions/ai-providers";
import { resetAiProviderConfig, saveAiProviderConfig } from "@/lib/actions/ai-providers";
import { CheckCircle2, Loader2, RotateCcw, Save, ShieldAlert, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

const EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;

const inputClass =
	"w-full px-4 py-2.5 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all disabled:opacity-60";

function ProviderCard({ provider }: { provider: AiProviderView }) {
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
			setError("Reason must be at least 10 characters.");
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
		<form
			onSubmit={handleSubmit}
			className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="font-black text-[#0A3D62] text-lg">{provider.label}</p>
					<p className="text-[11px] uppercase font-extrabold tracking-wider text-[#3D5568]">
						{provider.provider}
						{provider.configured ? "" : " · using built-in default"}
					</p>
				</div>
				<span
					className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
						provider.apiKeyPresent ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
					}`}
				>
					{provider.apiKeyPresent ? (
						<CheckCircle2 className="w-3 h-3" />
					) : (
						<XCircle className="w-3 h-3" />
					)}
					{provider.apiKeyPresent ? "Key detected" : "No key — inactive"}
				</span>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div className="space-y-1.5">
					<label
						htmlFor={`${provider.provider}-model`}
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Model
					</label>
					<input
						id={`${provider.provider}-model`}
						type="text"
						value={model}
						onChange={(e) => setModel(e.target.value)}
						disabled={isPending}
						placeholder={provider.model}
						className={inputClass}
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor={`${provider.provider}-priority`}
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Priority (lower runs first)
					</label>
					<input
						id={`${provider.provider}-priority`}
						type="number"
						min={0}
						max={1000}
						value={priority}
						onChange={(e) => setPriority(e.target.value)}
						disabled={isPending}
						className={inputClass}
					/>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor={`${provider.provider}-env`}
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						API key env var
					</label>
					<input
						id={`${provider.provider}-env`}
						type="text"
						value={apiKeyEnv}
						onChange={(e) => setApiKeyEnv(e.target.value)}
						disabled={isPending}
						placeholder={provider.apiKeyEnv}
						className={inputClass}
					/>
					<p className="text-[11px] text-[#3D5568]">
						Name only (e.g. <code>{provider.apiKeyEnv}</code>). The key itself is never stored here.
					</p>
				</div>

				<div className="space-y-1.5">
					<label
						htmlFor={`${provider.provider}-effort`}
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Reasoning effort
					</label>
					<select
						id={`${provider.provider}-effort`}
						value={reasoningEffort}
						onChange={(e) => setReasoningEffort(e.target.value as typeof reasoningEffort)}
						disabled={isPending}
						className={inputClass}
					>
						{EFFORT_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
					<p className="text-[11px] text-[#3D5568]">
						Ignored by providers without a reasoning parameter.
					</p>
				</div>
			</div>

			<label className="flex items-center gap-2.5 text-sm font-bold text-[#0A3D62]">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
					disabled={isPending}
					className="w-4 h-4 rounded border-gray-300 text-[#E85A2A] focus:ring-[#E85A2A]"
				/>
				Enabled in the fallback chain
			</label>

			<div className="space-y-1.5">
				<label
					htmlFor={`${provider.provider}-reason`}
					className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
				>
					Reason *
				</label>
				<input
					id={`${provider.provider}-reason`}
					type="text"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder="e.g. Rotate primary model to the cheaper tier"
					className={inputClass}
				/>
				<p className="text-[11px] text-[#3D5568]">
					Recorded in the platform audit log. At least 10 characters.
				</p>
			</div>

			{error && (
				<div className="bg-red-50 text-[#C42B3A] text-xs p-3 rounded-xl border border-red-200 flex items-start gap-2">
					<ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
					<span className="font-bold">{error}</span>
				</div>
			)}

			{saved && (
				<div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl border border-green-200">
					<span className="font-bold">Saved. New requests use this chain within 30 seconds.</span>
				</div>
			)}

			<button
				type="submit"
				disabled={isPending}
				className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#E85A2A] text-white font-bold text-sm rounded-xl hover:bg-[#d04a1f] transition-colors shadow-sm disabled:opacity-60"
			>
				{isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
				Save {provider.label}
			</button>
		</form>
	);
}

export function AiProviderSettings({ providers }: { providers: AiProviderView[] }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [reset, setReset] = useState(false);

	const handleReset = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (reason.trim().length < 10) {
			setError("Reason must be at least 10 characters.");
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

			<form
				onSubmit={handleReset}
				className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4"
			>
				<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
					Reset chain
				</p>
				<p className="text-sm text-[#3D5568]">
					Deletes every stored row and returns the platform to the built-in defaults (OpenCode Go,
					then Gemini). Environment variables are untouched.
				</p>

				<div className="space-y-1.5">
					<label
						htmlFor="ai-provider-reset-reason"
						className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
					>
						Reason *
					</label>
					<input
						id="ai-provider-reset-reason"
						type="text"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						disabled={isPending}
						placeholder="e.g. Roll back a bad model rollout"
						className={inputClass}
					/>
				</div>

				{error && (
					<div className="bg-red-50 text-[#C42B3A] text-xs p-3 rounded-xl border border-red-200 flex items-start gap-2">
						<ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
						<span className="font-bold">{error}</span>
					</div>
				)}

				{reset && (
					<div className="bg-green-50 text-green-700 text-xs p-3 rounded-xl border border-green-200">
						<span className="font-bold">Chain reset to defaults.</span>
					</div>
				)}

				<button
					type="submit"
					disabled={isPending}
					className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0A3D62] text-white font-bold text-sm rounded-xl hover:bg-[#082f4d] transition-colors shadow-sm disabled:opacity-60"
				>
					{isPending ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<RotateCcw className="w-4 h-4" />
					)}
					Reset to Defaults
				</button>
			</form>
		</div>
	);
}
