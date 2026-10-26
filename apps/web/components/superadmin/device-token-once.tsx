"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";

/**
 * A freshly issued device token, shown once.
 *
 * It lives in client state only (never the URL, storage or a server-rendered
 * payload) and is dropped when the admin confirms it has been set on the unit.
 */
export function DeviceTokenOnce({
	token,
	mac,
	onDone,
}: {
	token: string;
	mac: string;
	onDone: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setCopyFailed(false);
		} catch {
			// Clipboard is blocked outside a secure context; the token stays on
			// screen so it can be copied by hand.
			setCopyFailed(true);
		}
	};

	return (
		<div className="rounded-xl border border-[#F5B87A] bg-[#FFF4E8] p-4 space-y-3">
			<p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#8A4A00]">
				<KeyRound className="w-4 h-4" />
				Device token for {mac} — shown once
			</p>
			<code className="block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs font-bold text-[#0A3D62] border border-[#F5B87A]">
				{token}
			</code>
			<p className="text-[11px] leading-snug text-[#3D5568]">
				Enter it as <b>Device Token</b> (and the MAC as <b>Device ID</b>) in the unit&apos;s setup
				portal at 192.168.4.1. It is a credential: do not print it or paste it in chat. If it is
				lost, rotate the token.
			</p>
			{copyFailed && (
				<p className="text-[11px] font-bold text-[#C42B3A]">
					Copy failed — select the token and copy it manually.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={copy}
					className="inline-flex items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 bg-white px-3 py-1.5 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
				>
					{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
					{copied ? "Copied" : "Copy token"}
				</button>
				<button
					type="button"
					onClick={onDone}
					className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A3D62] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0A48A0]"
				>
					I have set it on the unit
				</button>
			</div>
		</div>
	);
}
