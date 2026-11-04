import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Tenant context for the dedicated `optifeed_app` database role (#711 Phase 2).
 *
 * The RLS policies read these transaction-local settings:
 *   app.farm_ids     User.farmId login slugs (OrgScope.farmIds)
 *   app.pond_ids     Pond ids (OrgScope.pondIds)
 *   app.user_id      User.id
 *   app.supabase_id  Supabase Auth user id
 *   app.org_ids      Organization ids (OrgScope.orgIds)
 *
 * `set_config(..., true)` is transaction-local, so pooled connections do not
 * leak one request's tenant into another. Callers must run every tenant query
 * through the `tx` handed to the callback.
 */

export type TenantContext = {
	farmIds: readonly string[];
	pondIds: readonly string[];
	userId: string;
	supabaseId: string;
	orgIds: readonly string[];
};

export type TenantConfigEntry = {
	key: string;
	value: string;
};

/** Settings to apply, in a stable order, omitting empty values. */
export function tenantConfigEntries(context: TenantContext): TenantConfigEntry[] {
	return [
		{ key: "app.farm_ids", value: context.farmIds.join(",") },
		{ key: "app.pond_ids", value: context.pondIds.join(",") },
		{ key: "app.user_id", value: context.userId },
		{ key: "app.supabase_id", value: context.supabaseId },
		{ key: "app.org_ids", value: context.orgIds.join(",") },
	].filter((entry) => entry.value.length > 0);
}

/**
 * Run `work` in a transaction that carries the tenant context.
 *
 * Do not nest this inside another Prisma transaction. Route handlers and
 * actions that already use a transaction should call `applyTenantContext(tx,
 * context)` inside that transaction instead.
 */
export async function withTenant<T>(
	context: TenantContext,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return prisma.$transaction(
		async (tx) => {
			await applyTenantContext(tx, context);
			return work(tx);
		},
		{ timeout: 15_000 },
	);
}

/** Apply the settings to an existing transaction. */
export async function applyTenantContext(
	tx: Prisma.TransactionClient,
	context: TenantContext,
): Promise<void> {
	for (const entry of tenantConfigEntries(context)) {
		await tx.$executeRaw`SELECT set_config(${entry.key}, ${entry.value}, true)`;
	}
}
