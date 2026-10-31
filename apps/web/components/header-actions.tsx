"use client";

import {
	ACCOUNT_MENU_DEVICE_STATUS,
	accountMenuAdminAction,
	accountMenuBadge,
	accountMenuCloseButton,
	accountMenuMutedText,
	accountMenuNavigationItem,
	accountMenuPanel,
	accountMenuPlatformAction,
	accountMenuSignOut,
	accountMenuTile,
} from "@/components/account-menu-theme";
import { clearChatHistory } from "@/components/chat/chat-storage";
import { useChatWidget } from "@/components/chat/chat-widget-provider";
import { DarkModeToggle } from "@/components/dark-mode-toggle";
import { HelpButton } from "@/components/help/help-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { PondSelector } from "@/components/pond-selector";
import { SearchTrigger } from "@/components/search/global-search";
import { UserAvatar } from "@/components/user-avatar";
import { useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { Globe, LogOut, Settings, Shield, ShieldAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type RefObject, useEffect, useRef, useState } from "react";

export type HeaderActionsUser = {
	email: string;
	role: string | null;
	displayName: string | null;
	/** Short-lived signed URL for the user's profile picture (#198). */
	avatarUrl?: string | null;
	isTenantAdmin: boolean;
	isPlatformAdmin: boolean;
};

interface HeaderActionsProps {
	ponds?: { id: string; name: string }[];
	activePondId?: string;
	pondName?: string;
	lastSeenAt?: string | null;
	esp32Status?: "online" | "weak" | "offline" | "missing";
	/** True while a read-only view-as session is active (the tenant view stays as-is). */
	isViewingAs?: boolean;
	/** Resolved server-side from the `help.centre` feature flag. */
	helpEnabled?: boolean;
	/** Resolved by the dashboard layout so the header does not fetch after hydration. */
	initialUser?: HeaderActionsUser;
}

type RelativeTimeKey =
	| "lastSyncedNever"
	| "lastSyncedJustNow"
	| "lastSyncedMinutesAgo"
	| "lastSyncedHoursAgo"
	| "lastSyncedDaysAgo";

type RelativeTimeTranslator = (key: RelativeTimeKey, values?: { count: number }) => string;

/**
 * #316: the relative time is a catalogue string of its own, with ICU plurals for
 * the count, and the caller plugs the result into `lastSynced` so the sentence
 * order belongs to the locale rather than to this function.
 */
function formatRelativeTime(dateStr: string | null, t: RelativeTimeTranslator): string {
	if (!dateStr) return t("lastSyncedNever");
	const date = new Date(dateStr);
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return t("lastSyncedJustNow");
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return t("lastSyncedMinutesAgo", { count: minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t("lastSyncedHoursAgo", { count: hours });
	const days = Math.floor(hours / 24);
	return t("lastSyncedDaysAgo", { count: days });
}

interface ProfileMenuProps {
	userEmail: string | null;
	userDisplayName: string;
	avatarUrl: string | null;
	showPlatformIdentity: boolean;
	ponds: { id: string; name: string }[];
	activePondId: string;
	pondName: string;
	esp32Status: "online" | "weak" | "offline" | "missing";
	isTenantAdmin: boolean;
	isPlatformAdmin: boolean;
	onClose: () => void;
	onLogout: () => void;
	/** The avatar button, so Escape and the close control can restore focus. */
	triggerRef: RefObject<HTMLButtonElement | null>;
	className?: string;
}

/**
 * The profile dropdown, shared by the desktop header and the mobile band.
 *
 * Kept as one component so the two surfaces can never drift: signing out also
 * clears the chat history, the dashboard snapshot and the offline queue in both
 * places (#48, T-11).
 */
function ProfileMenu({
	userEmail,
	userDisplayName,
	avatarUrl,
	showPlatformIdentity,
	ponds,
	activePondId,
	pondName,
	esp32Status,
	isTenantAdmin,
	isPlatformAdmin,
	onClose,
	onLogout,
	triggerRef,
	className,
}: ProfileMenuProps) {
	const router = useRouter();
	const locale = useLocale();
	const tCommon = useTranslations("dashboard.common");
	const deviceStatusLabel =
		esp32Status === "online"
			? tCommon("deviceOnline")
			: esp32Status === "weak"
				? tCommon("deviceWeak")
				: esp32Status === "offline"
					? tCommon("deviceOffline")
					: tCommon("deviceMissing");

	// Escape dismisses the disclosure and puts focus back on the avatar that
	// opened it, so keyboard readers are not dropped on <body>.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
			triggerRef.current?.focus();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, triggerRef]);

	return (
		<div
			className={`absolute top-12 right-0 z-50 w-[calc(100vw-2rem)] origin-top-right animate-in rounded-[28px] p-4 shadow-xl zoom-in-95 duration-200 sm:w-auto sm:min-w-[320px] ${accountMenuPanel} ${className ?? ""}`}
		>
			<div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-gray-700">
				<div className="flex items-center gap-3">
					<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E85A2A] text-lg font-black text-white">
						<UserAvatar
							src={avatarUrl}
							name={userDisplayName}
							size="lg"
							className="h-full w-full rounded-2xl bg-[#E85A2A]"
						/>
					</div>
					<div>
						<p className="text-base font-black">{userEmail ? userEmail.split("@")[0] : "User"}</p>
						<p className={`text-xs font-bold ${accountMenuMutedText}`}>
							{showPlatformIdentity ? tCommon("platformAdmin") : "Pond Operator"}
						</p>
						{!showPlatformIdentity && (
							<p
								className={`mt-0.5 font-mono text-[11px] font-bold uppercase ${accountMenuMutedText}`}
							>
								{ponds.find((p) => p.id === activePondId)?.name ??
									(pondName || tCommon("noPondTitle"))}
							</p>
						)}
					</div>
				</div>
				<button
					type="button"
					onClick={() => {
						onClose();
						triggerRef.current?.focus();
					}}
					className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:outline-none dark:focus-visible:ring-[#ff8a5c] ${accountMenuCloseButton}`}
					aria-label="Close profile menu"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
				<div className={`rounded-2xl p-3 ${accountMenuTile}`}>
					<p className={`font-black tracking-wide uppercase ${accountMenuMutedText}`}>Language</p>
					<p className="mt-1 text-lg font-black text-[#0A3D62] uppercase dark:text-[#5b9bd5]">
						{locale}
					</p>
				</div>
				<div className={`rounded-2xl p-3 ${accountMenuTile}`}>
					<p className={`font-black tracking-wide uppercase ${accountMenuMutedText}`}>Device</p>
					<p
						className={`mt-1 text-sm font-black uppercase ${ACCOUNT_MENU_DEVICE_STATUS[esp32Status]}`}
					>
						{deviceStatusLabel}
					</p>
				</div>
			</div>

			<div className="mt-4 space-y-2">
				{isTenantAdmin && (
					<button
						type="button"
						onClick={() => {
							onClose();
							router.push("/admin");
						}}
						className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 font-black transition focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:outline-none ${accountMenuAdminAction}`}
					>
						<span className="flex items-center gap-3">
							<Shield className="h-5 w-5" /> Admin Panel
						</span>
						<svg
							className="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</button>
				)}
				{isPlatformAdmin && (
					<button
						type="button"
						onClick={() => {
							onClose();
							router.push("/superadmin");
						}}
						className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 font-black transition focus-visible:ring-2 focus-visible:ring-[#0A3D62] focus-visible:outline-none dark:focus-visible:ring-[#8ec5ef] ${accountMenuPlatformAction}`}
					>
						<span className="flex items-center gap-3">
							<ShieldAlert className="h-5 w-5" /> Platform Console
						</span>
						<svg
							className="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							aria-hidden="true"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</button>
				)}
				<button
					type="button"
					onClick={() => {
						onClose();
						router.push("/dashboard/settings/profile");
					}}
					className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 font-black transition focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:outline-none ${accountMenuNavigationItem}`}
				>
					<span className="flex items-center gap-3">
						<Settings className="h-5 w-5 text-[#E85A2A] dark:text-[#ff8a5c]" /> Account settings
					</span>
					<svg
						className="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
					</svg>
				</button>
				<button
					type="button"
					onClick={() => {
						router.replace({ pathname: "/dashboard" }, { locale: locale === "en" ? "hil" : "en" });
						onClose();
					}}
					className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 font-black transition focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:outline-none ${accountMenuNavigationItem}`}
				>
					<span className="flex items-center gap-3">
						<Globe className="h-5 w-5 text-[#E85A2A] dark:text-[#ff8a5c]" /> Switch language
					</span>
					<span className={`rounded-lg px-2 py-1 text-xs uppercase ${accountMenuBadge}`}>
						{locale}
					</span>
				</button>
				<button
					type="button"
					onClick={onLogout}
					className={`flex min-h-14 w-full items-center justify-between rounded-2xl px-4 font-black transition focus-visible:ring-2 focus-visible:ring-[#C42B3A] focus-visible:outline-none ${accountMenuSignOut}`}
				>
					<span className="flex items-center gap-3">
						<LogOut className="h-5 w-5" /> Sign out
					</span>
					<svg
						className="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
					</svg>
				</button>
			</div>
		</div>
	);
}

export function HeaderActions({
	ponds = [],
	activePondId = "",
	pondName = "",
	lastSeenAt = null,
	esp32Status = "missing",
	isViewingAs = false,
	helpEnabled = true,
	initialUser,
}: HeaderActionsProps) {
	const [showProfileMenu, setShowProfileMenu] = useState(false);
	const profileButtonRef = useRef<HTMLButtonElement>(null);
	const userEmail = initialUser?.email ?? null;
	const userDisplayName = initialUser?.displayName || userEmail?.split("@")[0] || "User";
	const avatarUrl = initialUser?.avatarUrl ?? null;
	const isTenantAdmin = initialUser?.isTenantAdmin ?? false;
	const isPlatformAdmin = initialUser?.isPlatformAdmin ?? false;
	const router = useRouter();
	const { clearMessages } = useChatWidget();
	const tCommon = useTranslations("dashboard.common");

	// E18 (#199): a platform admin has no farm identity of their own, so the
	// pond name/selector and the last-synced line are not theirs to show. In
	// view-as the tenant dashboard stays exactly as it is.
	const showPlatformIdentity = isPlatformAdmin && !isViewingAs;

	const handleLogout = async () => {
		setShowProfileMenu(false);
		clearMessages();
		clearChatHistory();
		clearDashboardSnapshot();
		await clearOfflineData();
		const supabase = createClient();
		await supabase.auth.signOut();
		router.replace("/login");
	};

	return (
		<div className="relative flex items-center gap-2 md:gap-3">
			{!showPlatformIdentity && (
				<div className="hidden text-right sm:block">
					{/* The selector owns all three states: no ponds, a single pond and
					    a real choice. It must not fall back to a hard-coded pond name. */}
					<PondSelector ponds={ponds} activePondId={activePondId} />
					<p
						className="text-[10px] tracking-wider text-white/60 uppercase"
						suppressHydrationWarning
					>
						{tCommon("lastSynced", { time: formatRelativeTime(lastSeenAt, tCommon) })}
					</p>
				</div>
			)}

			<SearchTrigger className="hidden sm:flex" />

			<DarkModeToggle />
			<LocaleSwitcher />

			{helpEnabled && (
				<HelpButton audience={isTenantAdmin ? "owner" : "farmer"} className="hidden sm:flex" />
			)}

			<NotificationBell />

			<button
				ref={profileButtonRef}
				type="button"
				onClick={() => setShowProfileMenu((v) => !v)}
				className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#E85A2A] text-sm font-extrabold text-white shadow-sm transition hover:bg-[#f06d42] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
				aria-label="Open profile and settings menu"
				aria-expanded={showProfileMenu}
			>
				<UserAvatar
					src={avatarUrl}
					name={userDisplayName}
					size="md"
					className="h-full w-full rounded-full bg-[#E85A2A]"
				/>
			</button>

			{showProfileMenu && (
				<ProfileMenu
					userEmail={userEmail}
					userDisplayName={userDisplayName}
					avatarUrl={avatarUrl}
					showPlatformIdentity={showPlatformIdentity}
					ponds={ponds}
					activePondId={activePondId}
					pondName={pondName}
					esp32Status={esp32Status}
					isTenantAdmin={isTenantAdmin}
					isPlatformAdmin={isPlatformAdmin}
					onClose={() => setShowProfileMenu(false)}
					onLogout={handleLogout}
					triggerRef={profileButtonRef}
				/>
			)}
		</div>
	);
}

/**
 * Alerts + profile for the mobile header band's second row (E26).
 *
 * The desktop row keeps the pond block, theme, language and help controls; the
 * band has room for the two things a farmer reaches for on a phone. Everything
 * else (admin console, platform console, language, sign out) stays inside the
 * same profile menu, so no destination is lost when the row is compact.
 */
export function CompactHeaderActions({
	initialUser,
	isViewingAs = false,
	helpEnabled = true,
}: Pick<HeaderActionsProps, "initialUser" | "isViewingAs" | "helpEnabled">) {
	const [showProfileMenu, setShowProfileMenu] = useState(false);
	const profileButtonRef = useRef<HTMLButtonElement>(null);
	const userEmail = initialUser?.email ?? null;
	const userDisplayName = initialUser?.displayName || userEmail?.split("@")[0] || "User";
	const avatarUrl = initialUser?.avatarUrl ?? null;
	const isTenantAdmin = initialUser?.isTenantAdmin ?? false;
	const isPlatformAdmin = initialUser?.isPlatformAdmin ?? false;
	const router = useRouter();
	const { clearMessages } = useChatWidget();
	const showPlatformIdentity = isPlatformAdmin && !isViewingAs;

	const handleLogout = async () => {
		setShowProfileMenu(false);
		clearMessages();
		clearChatHistory();
		clearDashboardSnapshot();
		await clearOfflineData();
		const supabase = createClient();
		await supabase.auth.signOut();
		router.replace("/login");
	};

	return (
		<div className="relative flex items-center gap-1.5">
			{/* #269: the floating "?" is gone, so the band carries the same help
			    control as the desktop header. It is the one help entry point on
			    every dashboard width. */}
			{helpEnabled && (
				<HelpButton audience={isTenantAdmin ? "owner" : "farmer"} className="h-11 w-11" />
			)}
			<NotificationBell className="h-11 w-11" />
			<button
				ref={profileButtonRef}
				type="button"
				onClick={() => setShowProfileMenu((v) => !v)}
				className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#E85A2A] text-sm font-extrabold text-white shadow-sm transition hover:bg-[#f06d42] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
				aria-label="Open profile and settings menu"
				aria-expanded={showProfileMenu}
			>
				<UserAvatar
					src={avatarUrl}
					name={userDisplayName}
					size="md"
					className="h-full w-full rounded-full bg-[#E85A2A]"
				/>
			</button>

			{showProfileMenu && (
				<ProfileMenu
					userEmail={userEmail}
					userDisplayName={userDisplayName}
					avatarUrl={avatarUrl}
					showPlatformIdentity={showPlatformIdentity}
					ponds={[]}
					activePondId=""
					pondName=""
					esp32Status="missing"
					isTenantAdmin={isTenantAdmin}
					isPlatformAdmin={isPlatformAdmin}
					onClose={() => setShowProfileMenu(false)}
					onLogout={handleLogout}
					triggerRef={profileButtonRef}
				/>
			)}
		</div>
	);
}
