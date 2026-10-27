import { requirePasswordChanged } from "@/lib/auth/session";

/**
 * Chrome-free shell for printable pages (device stickers).
 *
 * It sits outside the (admin) and (superadmin) layouts on purpose: those are
 * a sticky header + sidebar + bottom nav in a flex column, which prints badly
 * and fragments multi-page output. This shell is plain block flow.
 *
 * The console gate lives one level down, next to each print page, because
 * the tenant and platform pages need different gates:
 * admin/devices/labels/layout.tsx (requireTenantAdmin) and
 * superadmin/devices/labels/layout.tsx (requirePlatformAdmin).
 */
export default async function PrintLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await requirePasswordChanged();

	return <div className="min-h-screen bg-[#F4F7F6] print:min-h-0 print:bg-white">{children}</div>;
}
