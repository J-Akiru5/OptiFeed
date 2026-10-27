"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
	Activity,
	BarChart3,
	Bell,
	CalendarDays,
	CalendarRange,
	Clock,
	Cpu,
	Droplets,
	FileText,
	Fish,
	FolderTree,
	History,
	Home,
	LayoutDashboard,
	type LucideIcon,
	MapPin,
	Menu,
	Plus,
	ScanLine,
	Search,
	Settings,
	Sparkles,
	TrendingUp,
	Users,
	X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MobileShell } from "./use-page-title";

export interface QuickMenuItem {
	id: string;
	label: string;
	href: string;
	icon: LucideIcon;
}

export interface QuickMenuSection {
	title: string;
	items: QuickMenuItem[];
}

/**
 * The contents of the "+" quick menu (E26).
 *
 * Pure so the menu can be asserted without opening a sheet: the admin-only
 * actions never appear for a farmer, and every destination the five-tab bottom
 * bar drops is still one tap away here.
 *
 * "Scan sticker QR" opens the Add feeder form instead of pretending to scan:
 * there is no scanner dependency in the app, and the printed QR carries the
 * setup Wi-Fi SSID, not the device id the form needs.
 */
export function quickMenuSections(input: {
	shell: MobileShell;
	isTenantAdmin: boolean;
	/** `useTranslations("dashboard.mobile")` */
	t: (key: string) => string;
	/** The shell's navigation namespace. */
	nav: (key: string) => string;
}): QuickMenuSection[] {
	const { shell, isTenantAdmin, t, nav } = input;

	if (shell === "admin") {
		return [
			{
				title: t("sections.actions"),
				items: [
					{
						id: "add-pond",
						label: t("actions.addPond"),
						href: "/admin/ponds/new",
						icon: Droplets,
					},
					{
						id: "add-feeder",
						label: t("actions.addFeeder"),
						href: "/admin/devices#add-feeder",
						icon: Cpu,
					},
					{
						id: "scan-sticker",
						label: t("actions.scanSticker"),
						href: "/admin/devices#add-feeder",
						icon: ScanLine,
					},
				],
			},
			{
				title: t("sections.destinations"),
				items: [
					{ id: "overview", label: nav("overview"), href: "/admin", icon: Home },
					{ id: "calendar", label: nav("calendar"), href: "/admin/calendar", icon: CalendarDays },
					{ id: "users", label: nav("users"), href: "/admin/users", icon: Users },
					{ id: "ponds", label: nav("ponds"), href: "/admin/ponds", icon: Droplets },
					{ id: "devices", label: nav("devices"), href: "/admin/devices", icon: Cpu },
					{ id: "hierarchy", label: nav("hierarchy"), href: "/admin/hierarchy", icon: FolderTree },
					{ id: "audit", label: nav("audit"), href: "/admin/audit", icon: FileText },
					{ id: "settings", label: nav("settings"), href: "/admin/settings", icon: Settings },
				],
			},
		];
	}

	if (shell === "platform") {
		return [
			{
				title: t("sections.actions"),
				items: [
					{
						id: "register-device",
						label: t("actions.registerDevice"),
						href: "/superadmin/devices#register-device",
						icon: Cpu,
					},
				],
			},
			{
				title: t("sections.destinations"),
				items: [
					{ id: "overview", label: nav("overview"), href: "/superadmin", icon: BarChart3 },
					{
						id: "calendar",
						label: nav("calendar"),
						href: "/superadmin/calendar",
						icon: CalendarDays,
					},
					{ id: "users", label: nav("users"), href: "/superadmin/users", icon: Users },
					{
						id: "organizations",
						label: nav("organizations"),
						href: "/superadmin/orgs",
						icon: FolderTree,
					},
					{ id: "ponds", label: nav("ponds"), href: "/superadmin/ponds", icon: Droplets },
					{ id: "devices", label: nav("devices"), href: "/superadmin/devices", icon: Cpu },
					{
						id: "operations",
						label: nav("operations"),
						href: "/superadmin/operations",
						icon: Activity,
					},
					{
						id: "ai-providers",
						label: nav("aiProviders"),
						href: "/superadmin/ai-providers",
						icon: Sparkles,
					},
					{ id: "settings", label: nav("settings"), href: "/superadmin/settings", icon: Settings },
				],
			},
		];
	}

	const actions: QuickMenuItem[] = [
		{ id: "log-sample", label: t("actions.logSample"), href: "/dashboard/log-sample", icon: Fish },
		{
			id: "pond-location",
			label: t("actions.pondLocation"),
			href: "/dashboard/settings/pond",
			icon: MapPin,
		},
	];

	// Pond and feeder creation live in the tenant admin console, which a plain
	// farmer cannot open; showing the action would only bounce them.
	if (isTenantAdmin) {
		actions.unshift(
			{
				id: "scan-sticker",
				label: t("actions.scanSticker"),
				href: "/admin/devices#add-feeder",
				icon: ScanLine,
			},
			{ id: "add-feeder", label: t("actions.addFeeder"), href: "/admin/devices", icon: Cpu },
			{ id: "add-pond", label: t("actions.addPond"), href: "/admin/ponds/new", icon: Droplets },
		);
	}

	return [
		{ title: t("sections.actions"), items: actions },
		{
			title: t("sections.destinations"),
			items: [
				{ id: "dashboard", label: nav("dashboard"), href: "/dashboard", icon: LayoutDashboard },
				{ id: "schedule", label: nav("schedule"), href: "/dashboard/schedule", icon: Clock },
				{ id: "log-sample", label: nav("logSample"), href: "/dashboard/log-sample", icon: Fish },
				{
					id: "calendar",
					label: nav("calendar"),
					href: "/dashboard/calendar",
					icon: CalendarRange,
				},
				{ id: "history", label: nav("history"), href: "/dashboard/history", icon: History },
				{ id: "growth", label: nav("growth"), href: "/dashboard/growth", icon: TrendingUp },
				{ id: "harvest", label: nav("harvest"), href: "/dashboard/harvest", icon: CalendarDays },
				{
					id: "notifications",
					label: nav("notifications"),
					href: "/dashboard/notifications",
					icon: Bell,
				},
				{ id: "audit", label: nav("audit"), href: "/dashboard/audit", icon: FileText },
				{ id: "settings", label: nav("settings"), href: "/dashboard/settings", icon: Settings },
			],
		},
	];
}

const triggerClass =
	"inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A3D62]";

/**
 * The header band's search and "+" controls and the bottom bar's "More" tab,
 * which all open one quick menu.
 *
 * The sheet is a bottom sheet on a phone (never taller than the viewport,
 * `dvh` so the browser chrome does not cut it off) with the search field first,
 * the shell's quick actions, and every destination of the shell. It is portalled
 * to `document.body` so the fixed bottom bar cannot sit above it.
 */
export function QuickMenu({
	shell,
	isTenantAdmin,
	trigger,
	label,
	active = false,
	className,
}: {
	shell: MobileShell;
	isTenantAdmin: boolean;
	trigger: "plus" | "search" | "more";
	/** Visible label for the `more` tab. */
	label?: string;
	/** True when the `more` tab represents the current page. */
	active?: boolean;
	className?: string;
}) {
	const t = useTranslations("dashboard.mobile");
	const nav = useTranslations(
		shell === "platform"
			? "superadmin.shell.nav"
			: shell === "admin"
				? "dashboard.adminShell.nav"
				: "nav",
	);
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [mounted, setMounted] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const sections = quickMenuSections({ shell, isTenantAdmin, t, nav });
	const needle = query.trim().toLowerCase();
	const filtered = sections
		.map((section) => ({
			...section,
			items: needle
				? section.items.filter((item) => item.label.toLowerCase().includes(needle))
				: section.items,
		}))
		.filter((section) => section.items.length > 0);

	useEffect(() => setMounted(true), []);

	// Close after the reader picks a destination.
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger; the effect closes the sheet when it changes.
	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	useEffect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		inputRef.current?.focus();
		return () => {
			document.body.style.overflow = previous;
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const isMore = trigger === "more";
	const triggerLabel =
		trigger === "plus" ? t("openMenu") : isMore ? t("moreLabel") : t("searchLabel");

	const triggerContent = (
		<>
			{trigger === "plus" ? (
				<Plus aria-hidden="true" className="h-5 w-5" />
			) : isMore ? (
				<Menu aria-hidden="true" className="h-5 w-5" />
			) : (
				<Search aria-hidden="true" className="h-5 w-5" />
			)}
			{isMore && (
				<span className="w-full truncate text-center text-[10px] leading-tight font-bold">
					{label ?? triggerLabel}
				</span>
			)}
			{isMore && active && (
				<span
					aria-hidden="true"
					className="absolute top-0 h-0.5 w-5 rounded-full bg-[#FF6B35] dark:bg-[#ff8a5c]"
				/>
			)}
		</>
	);

	const triggerClasses = isMore
		? cn(
				"relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
				active ? "text-white" : "text-white/75 hover:text-white",
				className,
			)
		: cn(triggerClass, className);

	if (!mounted) {
		// The trigger is rendered on the server; the sheet needs `document`.
		return (
			<button
				ref={triggerRef}
				type="button"
				aria-label={triggerLabel}
				aria-haspopup="dialog"
				data-mobile-trigger={trigger}
				className={triggerClasses}
			>
				{triggerContent}
			</button>
		);
	}

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => {
					setQuery("");
					setOpen(true);
				}}
				aria-label={triggerLabel}
				aria-haspopup="dialog"
				aria-expanded={open}
				data-mobile-trigger={trigger}
				className={triggerClasses}
			>
				{triggerContent}
			</button>

			{open &&
				createPortal(
					<div className="fixed inset-0 z-[70] lg:hidden">
						<button
							type="button"
							aria-label={t("close")}
							onClick={() => setOpen(false)}
							className="absolute inset-0 h-full w-full cursor-default bg-black/45"
						/>
						{/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> would need showModal() and its own stacking; this sheet is portalled, labelled and Escape-closable. */}
						<div
							role="dialog"
							aria-modal="true"
							aria-label={t("menuLabel")}
							className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-gray-900"
						>
							<div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-700" />
							<div className="flex items-center justify-between gap-3 px-4 pt-3">
								<p className="text-sm font-black text-[#0A3D62] dark:text-gray-100">
									{t("menuLabel")}
								</p>
								<button
									type="button"
									onClick={() => setOpen(false)}
									aria-label={t("close")}
									className="flex h-11 w-11 items-center justify-center rounded-full text-[#3D5568] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-300 dark:hover:bg-gray-800"
								>
									<X aria-hidden="true" className="h-5 w-5" />
								</button>
							</div>

							<div className="px-4 pt-2">
								<label htmlFor="mobile-quick-search" className="sr-only">
									{t("searchLabel")}
								</label>
								<div className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 dark:border-gray-700 dark:bg-gray-800">
									<Search
										aria-hidden="true"
										className="h-4 w-4 shrink-0 text-[#3D5568] dark:text-gray-400"
									/>
									<input
										ref={inputRef}
										id="mobile-quick-search"
										type="search"
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										placeholder={t("searchPlaceholder")}
										autoComplete="off"
										enterKeyHint="search"
										className="min-h-11 min-w-0 flex-1 bg-transparent text-sm font-bold text-[#0A3D62] placeholder:font-medium placeholder:text-[#3D5568]/70 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
									/>
								</div>
							</div>

							<div className="space-y-4 px-4 pt-4">
								{filtered.length === 0 && (
									<p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-[#3D5568] dark:border-gray-700 dark:text-gray-400">
										{t("noResults", { query: query.trim() })}
									</p>
								)}
								{filtered.map((section) => (
									<section key={section.title}>
										<h2 className="text-[10px] font-black tracking-widest text-[#3D5568] uppercase dark:text-gray-400">
											{section.title}
										</h2>
										<ul className="mt-2 space-y-1">
											{section.items.map((item) => (
												<li key={item.id}>
													<Link
														href={item.href}
														onClick={() => setOpen(false)}
														className="flex min-h-12 items-center gap-3 rounded-xl px-2 text-sm font-bold text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-100 dark:hover:bg-gray-800"
													>
														<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62]/8 text-[#0A3D62] dark:bg-white/10 dark:text-[#8fc0ea]">
															<item.icon aria-hidden="true" className="h-5 w-5" />
														</span>
														<span className="min-w-0 truncate">{item.label}</span>
													</Link>
												</li>
											))}
										</ul>
									</section>
								))}
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
