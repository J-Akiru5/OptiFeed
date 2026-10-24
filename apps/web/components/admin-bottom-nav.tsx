"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { CalendarDays, Cpu, Droplets, FileText, Home, Users } from "lucide-react";

/**
 * Admin console navigation below `lg`, where AdminSidebar is hidden.
 * Hierarchy and Settings stay in the sidebar.
 */
const navItems = [
	{ href: "/admin", label: "Overview", icon: Home },
	{ href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
	{ href: "/admin/users", label: "Users", icon: Users },
	{ href: "/admin/ponds", label: "Ponds", icon: Droplets },
	{ href: "/admin/devices", label: "Devices", icon: Cpu },
	{ href: "/admin/audit", label: "Audit", icon: FileText },
];

export function AdminBottomNav() {
	const pathname = usePathname();

	return (
		<nav
			aria-label="Admin navigation"
			className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A3D62] border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
		>
			<ul className="flex items-stretch px-1">
				{navItems.map((item) => {
					const isActive =
						item.href === "/admin"
							? pathname === "/admin" || pathname === "/admin/"
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
