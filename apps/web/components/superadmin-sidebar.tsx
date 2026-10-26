"use client";

import { Link, usePathname, useRouter } from "@/i18n/routing";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
	BarChart3,
	Cpu,
	Droplets,
	FolderTree,
	Loader2,
	LogOut,
	Sparkles,
	Users,
} from "lucide-react";
import { useState } from "react";

const navItems = [
	{ href: "/superadmin", label: "Overview", icon: BarChart3 },
	{ href: "/superadmin/users", label: "Users", icon: Users },
	{ href: "/superadmin/orgs", label: "Organizations", icon: FolderTree },
	{ href: "/superadmin/ponds", label: "Ponds", icon: Droplets },
	{ href: "/superadmin/devices", label: "Devices", icon: Cpu },
	{ href: "/superadmin/ai-providers", label: "AI Providers", icon: Sparkles },
];

/**
 * Platform console navigation.
 *
 * Intentionally has no Schedule / Hierarchy / Settings entries: the
 * superadmin is read-only on farm operations (3-tier model, no interference
 * in farmer work). Ponds here is a visibility table, not a control surface.
 *
 * Devices is the hardware registry (plan v2, M3F): register units, rotate
 * tokens and print stickers. It has no feed, schedule or control function.
 *
 * AI Providers is the one configuration surface, and it is platform-level only:
 * it controls the model chain every tenant shares, not any farm's data.
 */
export function SuperadminSidebar() {
	const pathname = usePathname();
	const router = useRouter();
	const supabase = createClient();
	const [isSigningOut, setIsSigningOut] = useState(false);

	// Self-contained rather than reusing LogoutButton: that component reads
	// useChatWidget(), which only exists inside the dashboard's provider tree.
	const handleSignOut = async () => {
		setIsSigningOut(true);
		clearDashboardSnapshot();
		await clearOfflineData();
		await supabase.auth.signOut();
		router.replace("/");
	};

	return (
		<aside className="hidden lg:flex w-64 bg-[#0A3D62] text-white flex-col p-6 shrink-0 sticky top-[64px] h-[calc(100vh-64px)] z-20 overflow-y-auto scrollbar-none">
			<div className="space-y-1">
				<p className="text-[10px] font-extrabold uppercase text-white/50 tracking-widest px-3 mb-3">
					Platform Console
				</p>
				{navItems.map((item) => {
					const isActive =
						item.href === "/superadmin"
							? pathname === "/superadmin" || pathname === "/superadmin/"
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
					<BarChart3 className="w-4 h-4 shrink-0" />
					Back to Dashboard
				</Link>
				<button
					type="button"
					onClick={handleSignOut}
					disabled={isSigningOut}
					className="w-full flex items-center gap-3 p-3.5 rounded-2xl font-bold text-white/50 hover:text-white hover:bg-white/10 transition-all text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus:ring-white"
				>
					{isSigningOut ? (
						<Loader2 className="w-4 h-4 shrink-0 animate-spin" />
					) : (
						<LogOut className="w-4 h-4 shrink-0" />
					)}
					Sign Out
				</button>
			</div>
		</aside>
	);
}
