"use client";

import { DeviceTokenOnce } from "@/components/superadmin/device-token-once";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { Alert, FOCUS_RING, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { rotateDeviceToken } from "@/lib/actions/platform/devices";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;

/**
 * Issue a new token for one device. The old token stops working immediately,
 * so the unit is offline until the new one is set in its setup portal.
 */
export function RotateDeviceToken({ deviceId, mac }: { deviceId: string; mac: string }) {
	const t = useTranslations("superadmin.rotateToken");
	const tCommon = useTranslations("superadmin.common");
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
				data-help="superadmin-rotate-token"
				aria-label={t("aria", { mac })}
				className={SECONDARY_BUTTON}
			>
				<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
				{t("button")}
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
				setError(err instanceof Error ? err.message : t("failed"));
			}
		});
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (reason.trim().length < MIN_REASON) {
			setError(tCommon("reasonMinLength", { count: MIN_REASON }));
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
			<form onSubmit={submit} className="min-w-[16rem] space-y-2" aria-busy={isPending}>
				<p className="text-[11px] font-bold leading-snug text-[#C42B3A] dark:text-red-300">
					{t("warning")}
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={tCommon("reasonPlaceholderShort")}
					aria-label={t("reasonAria")}
					className="w-full rounded-lg border border-gray-200 dark:border-[#24304A] bg-[#F4F7F6] dark:bg-[#0B1220] px-3 py-2 text-xs text-[#0A3D62] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
				/>
				{error && <Alert tone="error">{error}</Alert>}
				<div className="flex gap-2">
					<button
						type="submit"
						disabled={isPending}
						className={cn(PRIMARY_BUTTON, "px-3 py-1.5 text-xs font-black")}
					>
						{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
						{t("rotate")}
					</button>
					<button
						type="button"
						onClick={() => setOpen(false)}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{tCommon("cancel")}
					</button>
				</div>
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("stepUpAction")}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}
