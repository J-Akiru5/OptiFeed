"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { useRouter } from "@/i18n/routing";
import { remoteFeedDevice, remoteSetDevicePause } from "@/lib/actions/platform/devices";
import { Loader2, Pause, Play, Sliders, Wheat } from "lucide-react";
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
				aria-label={`Remote control for ${label}`}
				className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
			>
				<Sliders className="w-3.5 h-3.5" />
				Remote control
			</button>
		);
	}

	const fail = (text: string) => setMessage({ tone: "error", text });

	const validateReason = (): string | null => {
		const trimmed = reason.trim();
		if (trimmed.length < MIN_REASON) {
			fail(`Reason must be at least ${MIN_REASON} characters.`);
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
						setMessage({ tone: "refused", text: `Refused — ${result.error}` });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.message ?? `Feed request for ${amount} g queued.`,
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : "The feed command failed.");
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
						setMessage({ tone: "refused", text: `Refused — ${result.error}` });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.isPaused ? "Schedule paused." : "Schedule resumed.",
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : "The schedule command failed.");
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
			fail(`Feed amount must be between ${MIN_GRAMS} and ${MAX_GRAMS} g.`);
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

	const messageTone =
		message?.tone === "ok"
			? "border-green-200 bg-green-50 text-[#1E7B34]"
			: message?.tone === "refused"
				? "border-amber-200 bg-amber-50 text-amber-800"
				: "border-red-200 bg-red-50 text-[#C42B3A]";

	return (
		<>
			<form onSubmit={submitFeed} className="min-w-[16rem] space-y-2">
				<p className="text-[11px] font-bold leading-snug text-[#3D5568]">
					Commands use the normal server caps: max {MAX_GRAMS} g per feed and the daily limit. The
					unit can still refuse (empty hopper, offline).
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder="Reason (at least 10 characters)"
					aria-label={`Reason for controlling ${label}`}
					className="w-full rounded-lg border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
				<div className="flex items-end gap-2">
					<label className="flex-1 text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]">
						Grams
						<input
							type="number"
							min={MIN_GRAMS}
							max={MAX_GRAMS}
							step="1"
							value={grams}
							onChange={(e) => setGrams(e.target.value)}
							disabled={isPending}
							className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
						/>
					</label>
					<button
						type="submit"
						disabled={isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-[#E85A2A] px-3 py-2 text-xs font-black text-white disabled:opacity-60"
					>
						{isPending ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Wheat className="w-3.5 h-3.5" />
						)}
						Feed
					</button>
				</div>

				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={submitPause}
						disabled={isPending}
						className="inline-flex items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 px-3 py-1.5 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6] disabled:opacity-60"
					>
						{isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
						{isPaused ? "Resume schedule" : "Pause schedule"}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						disabled={isPending}
						className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-black text-[#3D5568]"
					>
						Close
					</button>
				</div>

				{message && (
					<p className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${messageTone}`}>
						{message.text}
					</p>
				)}
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={`control feeder ${label}`}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}
