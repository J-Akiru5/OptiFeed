"use client";

import { clearChatHistory } from "@/components/chat/chat-storage";
import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { Loader2, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function LogoutButton() {
	const t = useTranslations("dashboard.settings");
	const [isPending, setIsPending] = useState(false);
	const router = useRouter();
	const supabase = createClient();
	const { clearMessages } = useChatWidget();

	const handleLogout = async () => {
		setIsPending(true);
		clearMessages();
		clearChatHistory();
		clearDashboardSnapshot();
		await clearOfflineData();
		await supabase.auth.signOut();
		// Redirect to home/login page after logout
		router.replace("/");
	};

	return (
		<button
			type="button"
			onClick={handleLogout}
			disabled={isPending}
			className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 text-sm font-black text-[#C42B3A] transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 dark:hover:bg-red-900/40 dark:focus-visible:outline-[#8fc0ea]"
		>
			{isPending ? (
				<Loader2 size={18} className="animate-spin" aria-hidden="true" />
			) : (
				<LogOut size={18} aria-hidden="true" />
			)}
			{t("signOutButton")}
		</button>
	);
}
