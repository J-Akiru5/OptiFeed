"use client";

import { DeviceTokenOnce } from "@/components/superadmin/device-token-once";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { rotateDeviceToken } from "@/lib/actions/platform/devices";
import { KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;

/**
 * Issue a new token for one device. The old token stops working immediately,
 * so the unit is offline until the new one is set in its setup portal.
 */
export function RotateDeviceToken({ deviceId, mac }: { deviceId: string; mac: string }) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);
	const [isPending, startTransition] = useTransition();

	if (token) {
		return (
			<div className="min-w-[16rem]">
				<DeviceTokenOnce token={token} mac={mac} onDone={() => setToken(null)} />
			</div>
		);
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => {
					setOpen(true);
					setReason("");
					setError(null);
				}}
				aria-label={`Rotate token — ${mac}`}
				className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
			>
				<KeyRound className="w-3.5 h-3.5" />
				Rotate token
			</button>
		);
	}

	const run = (trimmedReason: string) => {
		startTransition(async () => {
			try {
				const result = await rotateDeviceToken({ deviceId, reason: trimmedReason });
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => run(trimmedReason);
						setStepUpOpen(true);
						return;
					}
					setError(result.error);
					return;
				}
				setOpen(false);
				setReason("");
				setToken(result.token);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Rotation failed.");
			}
		});
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (reason.trim().length < MIN_REASON) {
			setError(`Reason must be at least ${MIN_REASON} characters.`);
			return;
		}
		run(reason.trim());
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<>
			<form onSubmit={submit} className="min-w-[16rem] space-y-2">
				<p className="text-[11px] leading-snug text-[#C42B3A] font-bold">
					The current token stops working at once. The unit stays offline until the new token is set
					in its setup portal.
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder="Reason (at least 10 characters)"
					aria-label="Reason for rotating the token"
					className="w-full px-3 py-2 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
				{error && <p className="text-[11px] font-bold text-[#C42B3A]">{error}</p>}
				<div className="flex gap-2">
					<button
						type="submit"
						disabled={isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-[#E85A2A] px-3 py-1.5 text-xs font-black text-white disabled:opacity-60"
					>
						{isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
						Rotate
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						disabled={isPending}
						className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-black text-[#3D5568]"
					>
						Cancel
					</button>
				</div>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel="rotate this device token"
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}
