import { requirePasswordChanged } from "@/lib/auth/session";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";

/**
 * Chrome-free shell for printable admin pages (device stickers).
 *
 * It sits outside the (admin) layout on purpose: that layout is a sticky
 * header + sidebar + bottom nav in a flex column, which prints badly and
 * fragments multi-page output. This shell is plain block flow, and has the
 * same gate as (admin)/layout.tsx.
 */
export default async function PrintLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await requirePasswordChanged();
	await requireTenantAdmin();

	return <div className="min-h-screen bg-[#F4F7F6] print:min-h-0 print:bg-white">{children}</div>;
}
