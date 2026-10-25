"use client";

import { CheckCircle2, CircleAlert, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatActionState } from "./chat-storage";

interface ChatActionCardProps {
	action: ChatActionState;
	disabled?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ChatActionCard({ action, disabled, onConfirm, onCancel }: ChatActionCardProps) {
	const t = useTranslations("chat");
	const pending = action.status === "pending";

	return (
		<div className="mt-2 overflow-hidden rounded-2xl border border-[#0A3D62]/15 bg-white text-left shadow-sm dark:border-gray-700 dark:bg-gray-900">
			<div className="bg-[#0A3D62] px-3 py-2 text-[10px] font-extrabold uppercase tracking-widest text-blue-100">
				{t("actionPreview")}
			</div>
			<div className="space-y-2 p-3 text-xs text-gray-700 dark:text-gray-200">
				<p className="font-semibold leading-relaxed">{action.summary}</p>
				<dl className="grid gap-1">
					{action.fields.map((field) => (
						<div key={`${field.label}-${field.value}`} className="flex justify-between gap-3">
							<dt className="text-gray-500 dark:text-gray-400">{field.label}</dt>
							<dd className="text-right font-semibold">{field.value}</dd>
						</div>
					))}
				</dl>
				{pending ? (
					<div className="flex gap-2 pt-1">
						<button
							type="button"
							onClick={onConfirm}
							disabled={disabled}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[#E85A2A] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#d14e22] disabled:opacity-50"
						>
							{disabled && <Loader2 className="h-3 w-3 animate-spin" />}
							{t("actionConfirm")}
						</button>
						<button
							type="button"
							onClick={onCancel}
							disabled={disabled}
							className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							{t("actionCancel")}
						</button>
					</div>
				) : (
					<p
						className={`flex items-center gap-1.5 pt-1 text-xs font-bold ${
							action.status === "confirmed"
								? "text-green-600"
								: action.status === "cancelled"
									? "text-gray-500"
									: "text-red-600"
						}`}
					>
						{action.status === "confirmed" ? (
							<CheckCircle2 className="h-3.5 w-3.5" />
						) : action.status === "cancelled" ? (
							<XCircle className="h-3.5 w-3.5" />
						) : (
							<CircleAlert className="h-3.5 w-3.5" />
						)}
						{action.status === "confirmed"
							? t("actionConfirmed")
							: action.status === "cancelled"
								? t("actionCancelled")
								: t("actionFailed")}
						{action.result ? ` — ${action.result}` : ""}
					</p>
				)}
			</div>
		</div>
	);
}
