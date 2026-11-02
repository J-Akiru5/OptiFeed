"use client";

import { clearChatHistory } from "@/components/chat/chat-storage";
import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { UserAvatar } from "@/components/user-avatar";
import { Link, useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Loader2, LogOut, Settings, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Account menu for the platform console (issue #560).
 *
 * The console used to show a bare avatar: it linked to `/dashboard/settings/profile`
 * only when the platform admin also had a tenant membership, so a platform-only
 * account had no way to reach its profile, settings or sign out — especially
 * below `lg`, where the sidebar (and its sign-out) is hidden.
 *
 * This is the same disclosure pattern for both headers: the avatar is a button,
 * the panel carries the identity and the account actions, Escape closes it and
 * returns focus to the trigger, and signing out clears the cached chat, offline
 * and dashboard state exactly like the sidebar does.
 */

export type SuperadminAccountMenuUser = {
	displayName: string;
	email: string;
	farmId: string;
	role: string;
	avatarUrl: string | null;
};

export function SuperadminAccountMenu({
	user,
	hasFarmDashboard,
}: {
	user: SuperadminAccountMenuUser;
	hasFarmDashboard: boolean;
}) {
	const t = useTranslations("superadmin.account");
	const tShell = useTranslations("superadmin.shell");
	const router = useRouter();
	const { clearMessages } = useChatWidget();
	const supabase = createClient();

	const [open, setOpen] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId();

	useEffect(() => {
		if (!open) return;

		const close = () => {
			setOpen(false);
			triggerRef.current?.focus();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setOpen(false);
		};

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open]);

	// Move focus into the panel so a keyboard or screen-reader user lands on the
	// first action instead of staying on the avatar.
	useEffect(() => {
		if (open) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
	}, [open]);

	const signOut = async () => {
		setSigningOut(true);
		clearMessages();
		clearChatHistory();
		clearDashboardSnapshot();
		await clearOfflineData();
		await supabase.auth.signOut();
		router.replace("/");
	};

	const itemClass =
		"flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-slate-100 dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]";

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				aria-label={t("menuLabel")}
				className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
			>
				<UserAvatar
					src={user.avatarUrl}
					name={user.displayName}
					size="md"
					className="rounded-full bg-[#E85A2A]"
				/>
			</button>

			{open ? (
				<div
					ref={panelRef}
					id={panelId}
					className="absolute top-full right-0 z-50 mt-2 max-h-[min(70vh,28rem)] w-72 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 text-[#0A3D62] shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-slate-100"
				>
					<div className="px-3 py-2">
						<p className="truncate text-sm font-black">{user.displayName}</p>
						<p className="truncate text-[11px] text-[#3D5568] dark:text-slate-400">{user.email}</p>
						<p className="mt-1 truncate text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-slate-400">
							{user.role} · {user.farmId}
						</p>
					</div>

					<nav
						aria-label={t("menuLabel")}
						className="space-y-0.5 border-t border-gray-100 pt-2 dark:border-gray-800"
					>
						<Link href="/superadmin/account" className={itemClass}>
							<User className="size-4 shrink-0" aria-hidden="true" />
							{t("menuProfile")}
						</Link>
						<Link href="/superadmin/settings" className={itemClass}>
							<Settings className="size-4 shrink-0" aria-hidden="true" />
							{t("menuSettings")}
						</Link>
						{hasFarmDashboard ? (
							<Link href="/dashboard" className={itemClass}>
								<LayoutDashboard className="size-4 shrink-0" aria-hidden="true" />
								{t("menuFarm")}
							</Link>
						) : null}
					</nav>

					<div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
						<button
							type="button"
							onClick={signOut}
							disabled={signingOut}
							className={cn(
								itemClass,
								"text-[#C42B3A] hover:bg-[#FDE8EA] disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950/40",
							)}
						>
							{signingOut ? (
								<Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
							) : (
								<LogOut className="size-4 shrink-0" aria-hidden="true" />
							)}
							{tShell("signOut")}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
