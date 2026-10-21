import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Link } from "@/i18n/routing";
import { getCurrentUser, requireRole } from "@/lib/auth/session";

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await requireRole("ADMIN");

	return (
		<div className="flex flex-col min-h-screen bg-[#F4F7F6]">
			{/* Header */}
			<header className="sticky top-0 z-30 w-full h-16 bg-[#0A3D62] px-4 md:px-8 flex items-center justify-between shadow-md shrink-0">
				<div className="flex items-center gap-3">
					<Link
						href="/admin"
						className="flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
					>
						<OptiFeedLogo size={32} />
					</Link>
					<span className="font-extrabold text-lg md:text-xl tracking-tight text-white">
						Opti<span className="text-[#E85A2A]">Feed</span>
					</span>
					<span className="hidden md:inline-flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded-full bg-[#E85A2A] text-[10px] font-black uppercase tracking-wider text-white">
						Admin
					</span>
				</div>

				<div className="flex items-center gap-3">
					<Link
						href="/dashboard"
						className="text-sm font-bold text-white/70 hover:text-white transition-colors"
					>
						Dashboard
					</Link>
				</div>
			</header>

			<div className="flex w-full flex-1 min-h-[calc(100vh-4rem)]">
				<AdminSidebar />
				<main className="flex-1 p-4 md:p-8 relative z-10">{children}</main>
			</div>
		</div>
	);
}
