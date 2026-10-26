"use client";

import { startStepUp } from "@/lib/actions/step-up";
import { KeyRound, Loader2, X } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

/**
 * Step-up re-authentication dialog (plan M3.3).
 *
 * Shown when a dangerous action answers `step_up_required`: the admin re-enters
 * their own password, `startStepUp` verifies it with Supabase and sets the
 * signed 5-minute cookie, then the caller retries the original action.
 *
 * The password lives in this component's state only. Nothing is stored, and it
 * is cleared as soon as the action resolves.
 */
export function StepUpDialog({
	open,
	actionLabel,
	onClose,
	onVerified,
}: {
	open: boolean;
	/** What the retry will do, e.g. "rotate the device token". */
	actionLabel: string;
	onClose: () => void;
	onVerified: () => void;
}) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	if (!open) return null;

	const close = () => {
		if (isPending) return;
		setPassword("");
		setError(null);
		onClose();
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!password) {
			setError("Enter your password.");
			return;
		}

		startTransition(async () => {
			try {
				const result = await startStepUp(password);
				setPassword("");
				if ("error" in result) {
					setError(result.error);
					return;
				}
				setError(null);
				onVerified();
			} catch (err) {
				setPassword("");
				setError(err instanceof Error ? err.message : "Step-up failed.");
			}
		});
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A3D62]/40 p-4">
			<dialog
				open
				aria-modal="true"
				aria-labelledby="stepup-title"
				className="m-0 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
			>
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-2">
						<div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-[#F4F7F6] text-[#0A3D62]">
							<KeyRound className="h-4 w-4" />
						</div>
						<div>
							<p id="stepup-title" className="text-sm font-black text-[#0A3D62]">
								Confirm your password
							</p>
							<p className="mt-1 text-[11px] leading-snug text-[#3D5568]">
								To {actionLabel}, re-enter your own password. The check lasts 5 minutes.
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={close}
						disabled={isPending}
						aria-label="Close step-up dialog"
						className="rounded-lg p-1 text-[#3D5568] transition-colors hover:bg-[#F4F7F6] disabled:opacity-50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<form onSubmit={submit} className="mt-4 space-y-3">
					<div className="space-y-1.5">
						<label
							htmlFor="stepup-password"
							className="block text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568]"
						>
							Password *
						</label>
						<input
							id="stepup-password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							disabled={isPending}
							autoComplete="current-password"
							className="w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-sm text-[#0A3D62] transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
						/>
					</div>

					{error && (
						<p className="rounded-xl border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-[#C42B3A]">
							{error}
						</p>
					)}

					<div className="flex gap-2">
						<button
							type="submit"
							disabled={isPending}
							className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#E85A2A] px-3 py-2.5 text-xs font-extrabold text-white transition-all hover:bg-[#d04a1f] disabled:opacity-60"
						>
							{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							Continue
						</button>
						<button
							type="button"
							onClick={close}
							disabled={isPending}
							className="rounded-xl bg-[#F4F7F6] px-3 py-2.5 text-xs font-bold text-[#3D5568] transition-colors hover:bg-gray-200 disabled:opacity-60"
						>
							Cancel
						</button>
					</div>
				</form>
			</dialog>
		</div>
	);
}
