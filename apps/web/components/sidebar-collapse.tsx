"use client";

import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * One desktop preference shared by the farmer, tenant-admin and platform
 * sidebars, so a reader who collapses one console gets the same rail in the
 * other two.
 */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "optifeed:sidebar-collapsed";

const useIsomorphicLayoutEffect: typeof useLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Read the remembered collapse choice. Storage can throw in private mode. */
export function readSidebarCollapsed(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

/** Remember the choice. A failed write must never break the navigation. */
function writeSidebarCollapsed(collapsed: boolean): void {
	try {
		window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
	} catch {
		// Private mode or a full quota: the choice still applies for this visit.
	}
}

export interface SidebarCollapse {
	collapsed: boolean;
	/** True after mount, so the stored width does not animate on first paint. */
	animate: boolean;
	toggle: () => void;
}

/**
 * Resolve the desktop collapse state.
 *
 * Server and hydration render the expanded sidebar, matching the SSR markup.
 * The stored choice is then read in a layout effect, which React flushes before
 * the browser paints, so hydrating a collapsed sidebar does not jump. Width
 * transitions are enabled only after mount, so that first correction is instant.
 */
export function useSidebarCollapse(): SidebarCollapse {
	const [collapsed, setCollapsed] = useState(false);
	const [animate, setAnimate] = useState(false);

	useIsomorphicLayoutEffect(() => {
		setCollapsed(readSidebarCollapsed());
	}, []);

	useEffect(() => {
		setAnimate(true);

		// Keep two open tabs in step; the value is the same preference.
		const onStorage = (event: StorageEvent) => {
			if (event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY) return;
			setCollapsed(event.newValue === "1");
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const toggle = useCallback(() => {
		setCollapsed((current) => {
			const next = !current;
			writeSidebarCollapsed(next);
			return next;
		});
	}, []);

	return { collapsed, animate, toggle };
}

export interface SidebarCollapseToggleProps {
	collapsed: boolean;
	onToggle: () => void;
	labelCollapse: string;
	labelExpand: string;
	/** Id of the nav this button expands and collapses. */
	controls: string;
	tone?: "light" | "dark";
	className?: string;
}

/** Collapse/expand control. Native button, 44 px target, visible in both states. */
export function SidebarCollapseToggle({
	collapsed,
	onToggle,
	labelCollapse,
	labelExpand,
	controls,
	tone = "light",
	className,
}: SidebarCollapseToggleProps) {
	const label = collapsed ? labelExpand : labelCollapse;
	const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={label}
			aria-expanded={!collapsed}
			aria-controls={controls}
			title={label}
			className={cn(
				"flex min-h-11 w-full items-center rounded-2xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
				collapsed ? "justify-center p-3" : "gap-3 p-3.5",
				tone === "dark"
					? "text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-white"
					: "text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]",
				className,
			)}
		>
			<Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
			<span className={cn(collapsed && "sr-only")}>{label}</span>
		</button>
	);
}
