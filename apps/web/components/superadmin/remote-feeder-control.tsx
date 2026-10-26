"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { Alert, FIELD_LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { remoteFeedDevice, remoteSetDevicePause } from "@/lib/actions/platform/devices";
import { cn } from "@/lib/utils";
import { Loader2, Pause, Play, Sliders, Wheat } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;
const MIN_GRAMS = 1;
const MAX_GRAMS = 1000;

type Message = { tone: "ok" | "error" | "refused"; text: string };

/**
 * Remote feeder control from the platform device registry (plan M5.2, D1).
 *
 * Manual feed and pause/resume call the same server command as the tenant
 * dashboard. There is no force flag and no cap override: a refusal (offline,
 * daily cap, >1,000 g, fallow pond) comes back as `feed_refused`/`pause_refused`
 * and is displayed, never hidden. Every action needs a reason and a fresh
 * step-up, and writes one audit row under the real admin.
 */
export function RemoteFeederControl({
	deviceId,
	label,
	isPaused,
}: {
	deviceId: string;
	label: string;
	isPaused: boolean;
}) {
	const t = useTranslations("superadmin.remoteFeeder");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [grams, setGrams] = useState("150");
	const [message, setMessage] = useState<Message | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);
	const [isPending, startTransition] = useTransition();

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => {
					setOpen(true);
					setMessage(null);
				}}
				aria-label={t("openAria", { label })}
				className={SECONDARY_BUTTON}
			>
				<Sliders className="h-3.5 w-3.5" aria-hidden="true" />
				{t("open")}
			</button>
		);
	}

	const fail = (text: string) => setMessage({ tone: "error", text });

	const validateReason = (): string | null => {
		const trimmed = reason.trim();
		if (trimmed.length < MIN_REASON) {
			fail(tCommon("reasonMinLength", { count: MIN_REASON }));
			return null;
		}
		return trimmed;
	};

	const runFeed = (trimmedReason: string, amount: number) => {
		startTransition(async () => {
			try {
				const result = await remoteFeedDevice({ deviceId, grams: amount, reason: trimmedReason });
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => runFeed(trimmedReason, amount);
						setStepUpOpen(true);
						return;
					}
					if (result.code === "feed_refused") {
						setMessage({ tone: "refused", text: t("refused", { message: result.error }) });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.message ?? t("feedQueued", { amount }),
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : t("feedFailed"));
			}
		});
	};

	const runPause = (trimmedReason: string, nextPaused: boolean) => {
		startTransition(async () => {
			try {
				const result = await remoteSetDevicePause({
					deviceId,
					isPaused: nextPaused,
					reason: trimmedReason,
				});
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => runPause(trimmedReason, nextPaused);
						setStepUpOpen(true);
						return;
					}
					if (result.code === "pause_refused") {
						setMessage({ tone: "refused", text: t("refused", { message: result.error }) });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.isPaused ? t("paused") : t("resumed"),
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : t("pauseFailed"));
			}
		});
	};

	const submitFeed = (e: FormEvent) => {
		e.preventDefault();
		setMessage(null);
		const trimmed = validateReason();
		if (!trimmed) return;
		const amount = Number(grams);
		if (!Number.isFinite(amount) || amount < MIN_GRAMS || amount > MAX_GRAMS) {
			fail(t("feedAmountRange", { min: MIN_GRAMS, max: MAX_GRAMS }));
			return;
		}
		runFeed(trimmed, amount);
	};

	const submitPause = () => {
		setMessage(null);
		const trimmed = validateReason();
		if (!trimmed) return;
		runPause(trimmed, !isPaused);
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<>
			<form onSubmit={submitFeed} className="min-w-[16rem] space-y-2" aria-busy={isPending}>
				<p className="text-[11px] font-bold leading-snug text-[#3D5568]">
					{t("note", { max: MAX_GRAMS })}
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={tCommon("reasonPlaceholderShort")}
					aria-label={t("reasonAria", { label })}
					className="w-full rounded-lg border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
				/>
				<div className="flex items-end gap-2">
					<div className="flex-1">
						<label htmlFor={`grams-${deviceId}`} className={FIELD_LABEL}>
							{t("grams")}
						</label>
						<input
							id={`grams-${deviceId}`}
							type="number"
							min={MIN_GRAMS}
							max={MAX_GRAMS}
							step="1"
							value={grams}
							onChange={(e) => setGrams(e.target.value)}
							disabled={isPending}
							className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
						/>
					</div>
					<button
						type="submit"
						disabled={isPending}
						className={cn(PRIMARY_BUTTON, "px-3 py-2 text-xs font-black")}
					>
						{isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						) : (
							<Wheat className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{t("feed")}
					</button>
				</div>

				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={submitPause}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{isPaused ? (
							<Play className="h-3.5 w-3.5" aria-hidden="true" />
						) : (
							<Pause className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{isPaused ? t("resumeSchedule") : t("pauseSchedule")}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{t("close")}
					</button>
				</div>

				{message &&
					(message.tone === "ok" ? (
						<Alert tone="success">{message.text}</Alert>
					) : (
						<Alert tone={message.tone === "refused" ? "warning" : "error"}>{message.text}</Alert>
					))}
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("stepUpAction", { label })}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}
