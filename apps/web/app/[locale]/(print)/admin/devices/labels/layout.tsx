import { requireTenantAdmin } from "@/lib/auth/tenant-admin";

/** Same gate as (admin)/layout.tsx: an active OWNER/ADMIN membership. */
export default async function TenantLabelsLayout({ children }: { children: React.ReactNode }) {
	await requireTenantAdmin();
	return children;
}
