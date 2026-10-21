"use client";

import {
	grantPlatformAdmin,
	revokePlatformAdmin,
	revokePlatformUser,
} from "@/lib/actions/superadmin";
import { cn } from "@/lib/utils";
import { Loader2, MoreHorizontal, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

type Mode = "grant" | "revoke" | "delete" | null;

const MIN_REASON = 10;
const REASON_HELP =
	"Recorded in the platform audit log. At least 10 characters — say why this change is being made.";

/**
 * Per-row platform actions: grant/revoke god-mode, or remove the account.
 *
 * Every action demands a free-text reason because PlatformAuditLog.reason is
 * non-nullable (T5) — the form enforces the 10-char floor so a mutation can
 * never fail on an empty string.
 */
export function UserActions({
	userId,
	farmId,
	isPlatformAdmin,
}: {
	userId: string;
	farmId: string;
	isPlatformAdmin: boolean;
}) {
	const [mode, setMode] = useState<Mode>(null);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const open = (next: Exclude<Mode, null>) => {
		setMode(next);
		setReason("");
		setError(null);
	};
	const close = () => {
		if (isPending) return;
		setMode(null);
		setReason("");
		setError(null);
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		const trimmed = reason.trim();
		if (trimmed.length < MIN_REASON) {
			setError(`Reason must be at least ${MIN_REASON} characters.`);
			return;
		}

		startTransition(async () => {
			try {
				const result =
					mode === "grant"
						? await grantPlatformAdmin(userId, trimmed)
						: mode === "revoke"
							? await revokePlatformAdmin(userId, trimmed)
							: await revokePlatformUser(userId, trimmed);

				if ("error" in result && result.error) {
					setError(result.error);
					return;
				}
				setMode(null);
				setReason("");
			} catch (e) {
				setError(e instanceof Error ? e.message : "Action failed.");
			}
		});
	};

	const labels: Record<Exclude<Mode, null>, string> = {
		grant: "Grant platform access",
		revoke: "Revoke platform access",
		delete: "Delete account",
	};

	return (
		<div className="relative flex items-center justify-end">
			<button
				type="button"
				onClick={() => setMode(mode ? null : "grant")}
				disabled={isPending}
				aria-label={`Actions for ${farmId}`}
				className="p-2 rounded-xl text-[#3D5568] hover:text-[#0A3D62] hover:bg-[#F4F7F6] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
			>
				<MoreHorizontal className="w-4 h-4" />
			</button>

			{mode && (
				<div className="absolute right-0 top-11 z-40 w-72 bg-white rounded-2xl border border-gray-200 shadow-xl p-4 space-y-3">
					<div className="flex items-start justify-between gap-2">
						<div>
							<p className="font-black text-[#0A3D62] text-sm">{labels[mode]}</p>
							<p className="text-[11px] text-[#3D5568] font-mono">{farmId}</p>
						</div>
						<button
							type="button"
							onClick={close}
							disabled={isPending}
							aria-label="Close"
							className="p-1 rounded-lg text-[#3D5568] hover:bg-[#F4F7F6] transition-colors"
						>
							<X className="w-4 h-4" />
						</button>
					</div>

					{mode !== "delete" && (
						<div className="flex flex-wrap gap-1.5">
							<ActionButton
								active={mode === "grant"}
								onClick={() => open("grant")}
								icon={<ShieldCheck className="w-3.5 h-3.5" />}
								label="Grant"
							/>
							<ActionButton
								active={mode === "revoke"}
								onClick={() => open("revoke")}
								icon={<ShieldOff className="w-3.5 h-3.5" />}
								label="Revoke"
							/>
							<ActionButton
								active={false}
								onClick={() => open("delete")}
								icon={<Trash2 className="w-3.5 h-3.5" />}
								label="Delete"
								danger
							/>
						</div>
					)}

					<form onSubmit={submit} className="space-y-3">
						<div className="space-y-1.5">
							<label
								htmlFor={`reason-${farmId}`}
								className="block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]"
							>
								Reason *
							</label>
							<textarea
								id={`reason-${farmId}`}
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								rows={3}
								placeholder="e.g. Initial platform setup for deployment"
								className="w-full px-3 py-2 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all resize-none"
							/>
							<p className="text-[10px] text-[#3D5568]">{REASON_HELP}</p>
						</div>

						{error && (
							<p className="text-[11px] font-bold text-[#C42B3A] bg-red-50 border border-red-200 rounded-xl p-2">
								{error}
							</p>
						)}

						<div className="flex gap-2">
							<button
								type="submit"
								disabled={isPending}
								className={cn(
									"flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-extrabold rounded-xl text-white transition-all disabled:opacity-60",
									mode === "delete"
										? "bg-[#C42B3A] hover:bg-[#a92333]"
										: "bg-[#E85A2A] hover:bg-[#d04a1f]",
								)}
							>
								{isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
								Confirm
							</button>
							<button
								type="button"
								onClick={close}
								disabled={isPending}
								className="px-3 py-2.5 text-xs font-bold rounded-xl text-[#3D5568] bg-[#F4F7F6] hover:bg-gray-200 transition-colors disabled:opacity-60"
							>
								Cancel
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}

function ActionButton({
	active,
	onClick,
	icon,
	label,
	danger,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors",
				danger
					? active
						? "bg-[#C42B3A] text-white border-[#C42B3A]"
						: "bg-red-50 text-[#C42B3A] border-red-200 hover:bg-red-100"
					: active
						? "bg-[#E85A2A] text-white border-[#E85A2A]"
						: "bg-[#F4F7F6] text-[#3D5568] border-gray-200 hover:bg-gray-200",
			)}
		>
			{icon}
			{label}
		</button>
	);
}
