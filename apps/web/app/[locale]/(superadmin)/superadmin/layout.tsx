import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { SuperadminSidebar } from "@/components/superadmin-sidebar";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

/**
 * Platform console shell. Gated on the PlatformAdmin row, not UserRole —
 * an account can hold role=ADMIN and still be denied here, and a role=VIEWER
 * superadmin is allowed here. Mirrors (admin)/layout.tsx.
 */
export default async function SuperadminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await requirePlatformAdmin();

	return (
		<div className="flex flex-col min-h-screen bg-[#F4F7F6]">
			<header className="sticky top-0 z-30 w-full h-16 bg-[#0A3D62] px-4 md:px-8 flex items-center justify-between shadow-md shrink-0">
				<div className="flex items-center gap-3">
					<Link
						href="/superadmin"
						className="flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-lg"
					>
						<OptiFeedLogo size={32} />
					</Link>
					<span className="font-extrabold text-lg md:text-xl tracking-tight text-white">
						Opti<span className="text-[#E85A2A]">Feed</span>
					</span>
					<span className="hidden md:inline-flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded-full bg-[#E85A2A] text-[10px] font-black uppercase tracking-wider text-white">
						Platform
					</span>
				</div>
			</header>

			<div className="flex w-full flex-1 min-h-[calc(100vh-4rem)]">
				<SuperadminSidebar />
				<main className="flex-1 p-4 md:p-8 relative z-10">{children}</main>
			</div>
		</div>
	);
}
