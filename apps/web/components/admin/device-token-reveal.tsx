"use client";

import { revealDeviceToken } from "@/lib/actions/admin";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface DeviceTokenRevealProps {
	deviceId: string;
	deviceLabel: string;
}

/**
 * `requireRole` redirects an unauthorized caller by throwing a control-flow
 * error with a `NEXT_REDIRECT` digest. Swallowing it in the catch below would
 * turn a working redirect into a generic error the viewer cannot act on.
 */
function isRedirectError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("digest" in error)) return false;
	const { digest } = error as { digest?: unknown };
	return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * On-demand reveal of one device's provisioning token.
 *
 * The token is a device credential, so it is never part of the page render:
 * the admin table receives only display fields and this component asks the
 * server for the credential when the button is pressed. It lives in component
 * state only — never in the URL, localStorage or a server-rendered payload.
 */
export function DeviceTokenReveal({ deviceId, deviceLabel }: DeviceTokenRevealProps) {
	const t = useTranslations("dashboard.adminDevices");
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	async function handleReveal() {
		if (token) {
			// Hide: drop the credential from memory rather than leaving it on
			// screen after the admin is done.
			setToken(null);
			setCopied(false);
			setError(null);
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const result = await revealDeviceToken(deviceId);
			if (result.success) {
				setToken(result.token);
				setCopied(false);
			} else if (result.code === "rate_limited") {
				// The server sends a stable code because the message itself is
				// localized here, in the admin's current locale.
				setError(t("tokenRateLimited"));
			} else {
				setError(result.error);
			}
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("tokenError"));
		} finally {
			setLoading(false);
		}
	}

	async function handleCopy() {
		if (!token) return;
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setError(null);
		} catch {
			// Clipboard access is denied outside a secure context or by policy;
			// the token stays on screen so it can be copied by hand.
			setError(t("copyFailed"));
		}
	}

	return (
		<div className="flex min-w-[11rem] flex-col items-start gap-2">
			<button
				type="button"
				onClick={handleReveal}
				disabled={loading}
				aria-expanded={token !== null}
				aria-controls={`device-token-${deviceId}`}
				aria-label={`${token ? t("hideToken") : t("showToken")} — ${deviceLabel}`}
				className="rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:opacity-50 dark:border-gray-600 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
			>
				{loading ? t("loading") : token ? t("hideToken") : t("showToken")}
			</button>

			{token && (
				<div
					id={`device-token-${deviceId}`}
					className="w-full rounded-xl border border-[#0A3D62]/15 bg-[#F4F7F6] p-2.5 dark:border-gray-700 dark:bg-gray-800"
				>
					<p className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-300">
						{t("tokenColumn")}
					</p>
					<code className="mt-1 block font-mono text-[11px] font-bold break-all text-[#0A3D62] dark:text-gray-100">
						{token}
					</code>
					<button
						type="button"
						onClick={handleCopy}
						className="mt-2 rounded-lg border border-[#0A3D62]/20 bg-white px-2.5 py-1 text-[10px] font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:border-gray-600 dark:bg-gray-900 dark:text-[#8fc0ea] dark:hover:bg-gray-700 dark:focus-visible:outline-[#8fc0ea]"
					>
						{copied ? t("copied") : t("copy")}
					</button>
					<p className="mt-2 text-[10px] leading-snug text-[#3D5568] dark:text-gray-400">
						{t("tokenWarning")}
					</p>
				</div>
			)}

			{error && (
				<p role="alert" className="text-[11px] font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</p>
			)}
		</div>
	);
}
