import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

/** Same gate as (superadmin)/superadmin/layout.tsx: an active PlatformAdmin row. */
export default async function PlatformLabelsLayout({ children }: { children: React.ReactNode }) {
	await requirePlatformAdmin();
	return children;
}
