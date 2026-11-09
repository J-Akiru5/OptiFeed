import { resolveMemberOrgScope } from "@/lib/auth/org-scope";
import { getCurrentUser } from "@/lib/auth/session";
import { type TenantContext, runWithTenant, tenantPrisma } from "@/lib/db/tenant-context";
import { type PaginationState, resolvePagination } from "@/lib/pagination";
import type { Notification, Prisma } from "@prisma/client";

/**
 * Dashboard notification list (#711, option B, slice 2).
 *
 * The page used to read `Notification` directly with the privileged client.
 * The read unit of work now runs in the request's tenant transaction:
 *
 * - the context comes from the caller's *member* org scope, not the admin-only
 *   `resolveOrgScope`, because the notifications page is served to operators
 *   and viewers too. An admin-only scope would leave an operator with an empty
 *   context and make this page blank on the day `DATABASE_URL` switches;
 * - `Notification` policies key on `app.pond_ids` (the active pond plus the
 *   caller's org ponds), so the context carries the pond list;
 * - `getActivePond` and the identity/scope chain stay privileged on purpose:
 *   they produce the context and belong to the shared-read slice, not this one.
 *
 * Today the app still connects as `postgres` (`BYPASSRLS`), so this changes the
 * client identity and the settings applied, but not the rows returned. RLS
 * enforcement begins only when the connection role changes.
 */

export type DashboardNotificationFilters = {
	pondId: string;
	tier?: string;
	category?: string;
	page: number;
	pageSize: number;
};

export type DashboardNotifications = {
	total: number;
	notifications: Notification[];
	paging: PaginationState;
};

export async function loadDashboardNotifications({
	pondId,
	tier,
	category,
	page,
	pageSize,
}: DashboardNotificationFilters): Promise<DashboardNotifications> {
	// Bootstrap, not tenant data: both helpers derive the context from the
	// session, so they cannot run inside it yet.
	const [scope, user] = await Promise.all([resolveMemberOrgScope(), getCurrentUser()]);
	if (!user) throw new Error("Not authenticated.");

	const context: TenantContext = {
		farmIds: scope.farmIds,
		pondIds: scope.pondIds,
		orgIds: scope.orgIds,
		userId: user.id,
		supabaseId: user.supabaseId,
	};

	return runWithTenant(context, async () => {
		const db = tenantPrisma();
		const where: Prisma.NotificationWhereInput = { pondId, supersededById: null };
		if (tier && tier !== "all") where.tier = tier;
		if (category && category !== "all") where.category = category;

		const [total, firstFetch] = await Promise.all([
			db.notification.count({ where }),
			db.notification.findMany({
				where,
				orderBy: { createdAt: "desc" },
				skip: (page - 1) * pageSize,
				take: pageSize,
			}),
		]);
		const paging = resolvePagination(page, pageSize, total);
		const notifications =
			paging.page === page
				? firstFetch
				: await db.notification.findMany({
						where,
						orderBy: { createdAt: "desc" },
						skip: paging.offset,
						take: paging.pageSize,
					});

		return { total, notifications, paging };
	});
}
