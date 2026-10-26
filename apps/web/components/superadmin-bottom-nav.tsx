"use client";

import { FOCUS_RING_ON_DARK } from "@/components/superadmin/ui";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { BarChart3, Cpu, Droplets, FolderTree, Sparkles, Users } from "lucide-react";

/**
 * Platform console navigation below `lg`, where SuperadminSidebar is hidden.
 * Mirrors the sidebar's scope: Devices is the hardware registry plus remote
 * feeder control (M5.2); Ponds remains visibility only.
 *
 * The labels are shortened so all six sections fit six columns at 375 px
 * (AI Providers used to be reachable only from the desktop sidebar); the
 * `aria-label` keeps the full section name for screen readers.
 */
const navItems = [
	{ href: "/superadmin", label: "Overview", shortLabel: "Overview", icon: BarChart3 },
	{ href: "/superadmin/users", label: "Users", shortLabel: "Users", icon: Users },
	{ href: "/superadmin/orgs", label: "Organizations", shortLabel: "Orgs", icon: FolderTree },
	{ href: "/superadmin/ponds", label: "Ponds", shortLabel: "Ponds", icon: Droplets },
	{ href: "/superadmin/devices", label: "Devices", shortLabel: "Devices", icon: Cpu },
	{ href: "/superadmin/ai-providers", label: "AI Providers", shortLabel: "AI", icon: Sparkles },
];

export function SuperadminBottomNav() {
	const pathname = usePathname();

	return (
		<nav
			aria-label="Platform navigation"
			className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0A3D62] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)] lg:hidden"
		>
			<ul className="flex items-stretch px-1">
				{navItems.map((item) => {
					const isActive =
						item.href === "/superadmin"
							? pathname === "/superadmin" || pathname === "/superadmin/"
							: pathname.startsWith(item.href);

					return (
						<li key={item.href} className="min-w-0 flex-1">
							<Link
								href={item.href}
								aria-label={item.label}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2.5 transition-colors",
									FOCUS_RING_ON_DARK,
									isActive ? "text-white" : "text-white/80 hover:text-white",
								)}
							>
								<item.icon size={20} className="shrink-0" aria-hidden="true" />
								<span className="w-full truncate text-center text-[10px] font-bold leading-tight">
									{item.shortLabel}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
