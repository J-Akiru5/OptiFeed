"use client";

import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { BarChart3, Cpu, Droplets, FileText, Home, Settings, Users } from "lucide-react";

const navItems = [
	{ href: "/admin", label: "Overview", icon: Home },
	{ href: "/admin/users", label: "Users", icon: Users },
	{ href: "/admin/ponds", label: "Ponds", icon: Droplets },
	{ href: "/admin/devices", label: "Devices", icon: Cpu },
	{ href: "/admin/audit", label: "Audit Log", icon: FileText },
	{ href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar() {
	const pathname = usePathname();

	return (
		<aside className="hidden lg:flex w-64 bg-[#0A3D62] text-white flex-col p-6 shrink-0 sticky top-[64px] h-[calc(100vh-64px)] z-20 overflow-y-auto scrollbar-none">
			<div className="space-y-1">
				<p className="text-[10px] font-extrabold uppercase text-white/50 tracking-widest px-3 mb-3">
					Admin Panel
				</p>
				{navItems.map((item) => {
					const isActive =
						item.href === "/admin"
							? pathname === "/admin" || pathname === "/admin/"
							: pathname.startsWith(item.href);

					return (
						<Link
							key={item.href}
							href={item.href}
							className={cn(
								"w-full flex items-center gap-3 p-3.5 rounded-2xl font-bold transition-all text-[15px] focus-visible:outline-none focus-visible:ring-2 focus:ring-white",
								isActive
									? "bg-[#E85A2A] text-white shadow-md transform translate-x-1"
									: "text-white/70 hover:bg-white/10",
							)}
						>
							<item.icon className="w-5 h-5 shrink-0" />
							{item.label}
						</Link>
					);
				})}
			</div>

			<div className="mt-auto pt-6 border-t border-white/10">
				<Link
					href="/dashboard"
					className="flex items-center gap-3 p-3.5 rounded-2xl font-bold text-white/50 hover:text-white hover:bg-white/10 transition-all text-sm"
				>
					<BarChart3 className="w-4 h-4" />
					Back to Dashboard
				</Link>
			</div>
		</aside>
	);
}
