"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { BarChart3, Cpu, Droplets, FolderTree, Users } from "lucide-react";

/**
 * Platform console navigation below `lg`, where SuperadminSidebar is hidden.
 * Mirrors the sidebar's scope: no Schedule / Settings. Devices is the hardware
 * registry, not a control surface.
 */
const navItems = [
	{ href: "/superadmin", label: "Overview", icon: BarChart3 },
	{ href: "/superadmin/users", label: "Users", icon: Users },
	{ href: "/superadmin/orgs", label: "Organizations", icon: FolderTree },
	{ href: "/superadmin/ponds", label: "Ponds", icon: Droplets },
	{ href: "/superadmin/devices", label: "Devices", icon: Cpu },
];

export function SuperadminBottomNav() {
	const pathname = usePathname();

	return (
		<nav
			aria-label="Platform navigation"
			className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A3D62] border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
		>
			<ul className="flex items-stretch px-1">
				{navItems.map((item) => {
					const isActive =
						item.href === "/superadmin"
							? pathname === "/superadmin" || pathname === "/superadmin/"
							: pathname.startsWith(item.href);

					return (
						<li key={item.href} className="flex-1 min-w-0">
							<Link
								href={item.href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
									isActive ? "text-white" : "text-white/70 hover:text-white",
								)}
							>
								<item.icon size={20} className="shrink-0" />
								<span className="text-[10px] font-bold text-center leading-tight truncate w-full">
									{item.label}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
