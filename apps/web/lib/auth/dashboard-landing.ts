import { redirect } from "@/i18n/routing";
import { getLocale } from "next-intl/server";
import { hasActiveTenantMembership } from "./tenant-membership";

/**
 * Platform admins do not land on a farmer dashboard (E18, #199).
 *
 * A platform admin who is not in an active read-only view-as session owns no
 * tenant dashboard: the platform console is home, and tenant data is reached
 * through view-as. Login already sends them to `/superadmin`
 * (`getPostLoginDestination`); this gate covers a direct `/dashboard*`
 * navigation, an old bookmark or a stale client route.
 *
 * One deliberate exception: a platform admin who is *also* a tenant member
 * keeps a working farm dashboard, reached through the console's "Open my farm
 * dashboard" link. Membership is detected from `Membership` rows in an
 * `ACTIVE` organization (see `hasActiveTenantMembership`), never from the
 * legacy `User.role`. They still land on `/superadmin` by default.
 *
 * View-as is untouched: while the signed session is active the tenant
 * dashboard renders exactly as it does for the tenant. The caller passes the
 * resolved `viewAsActive`, so this helper never re-derives (and never
 * accidentally extends) view-as state.
 */
export async function redirectPlatformAdminFromDashboard(input: {
	isPlatformAdmin: boolean;
	viewAsActive: boolean;
	userId: string;
}): Promise<void> {
	if (!input.isPlatformAdmin) return;
	if (input.viewAsActive) return;
	if (await hasActiveTenantMembership(input.userId)) return;

	const locale = await getLocale();
	redirect({ href: "/superadmin", locale });
}
