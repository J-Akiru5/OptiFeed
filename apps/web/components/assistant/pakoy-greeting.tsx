"use client";

import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ASSISTANT_NAME, Mascot } from "./mascot";

const DISMISS_KEY = "optifeed:pakoy-greeting-dismissed:v1";
const SESSION_KEY = "optifeed:pakoy-greeting-shown:v1";

/**
 * Pakoy's first-visit greeting beside the floating chat button (#221).
 *
 * Shown once per session so it never nags; a dismissal is remembered in
 * `localStorage` (wrapped in try/catch, because private modes can throw). The
 * entrance animation is motion-safe only.
 */
export function PakoyGreeting() {
	const t = useTranslations("chat");
	const { isOpen, open } = useChatWidget();
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		let dismissed = false;
		let shownThisSession = false;
		try {
			dismissed = localStorage.getItem(DISMISS_KEY) === "true";
			shownThisSession = sessionStorage.getItem(SESSION_KEY) === "true";
		} catch {
			// Storage unavailable (private mode, blocked cookies): greet anyway.
		}
		if (!dismissed && !shownThisSession) setVisible(true);
	}, []);

	// Opening the chat answers the greeting, so retire it for this session.
	useEffect(() => {
		if (!isOpen || !visible) return;
		setVisible(false);
		markShownThisSession();
	}, [isOpen, visible]);

	if (!visible) return null;

	const retire = () => {
		setVisible(false);
		markShownThisSession();
	};

	const dismiss = () => {
		retire();
		try {
			localStorage.setItem(DISMISS_KEY, "true");
		} catch {
			// The greeting simply reappears next session.
		}
	};

	return (
		<div className="pointer-events-auto flex w-[min(17rem,calc(100vw-6.5rem))] items-end gap-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1">
			<output
				aria-live="polite"
				className="relative block rounded-2xl rounded-br-md border border-[#0A3D62]/10 bg-white px-3 py-2 pr-7 text-left shadow-lg dark:border-gray-700 dark:bg-gray-900"
			>
				<button
					type="button"
					onClick={dismiss}
					aria-label={t("greetingDismiss")}
					className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[#3D5568] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-400 dark:hover:bg-gray-800 dark:focus-visible:ring-[#8fc0ea]"
				>
					<X aria-hidden="true" className="h-3.5 w-3.5" />
				</button>
				<button type="button" onClick={() => open()} className="block text-left">
					<span className="block text-[11px] font-black uppercase tracking-wider text-[#C2410C] dark:text-[#ff8a5c]">
						{ASSISTANT_NAME}
					</span>
					<span className="mt-0.5 block text-xs font-semibold leading-snug text-[#0A3D62] dark:text-gray-100">
						{t("greeting")}
					</span>
				</button>
			</output>
			<Mascot pose="idle" size={56} className="drop-shadow-md" />
		</div>
	);
}

function markShownThisSession() {
	try {
		sessionStorage.setItem(SESSION_KEY, "true");
	} catch {
		// Session memory is best-effort.
	}
}
