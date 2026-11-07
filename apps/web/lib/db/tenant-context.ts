import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Request-scoped tenant context for the dedicated `optifeed_app` database role
 * (#711, option B, slice 1).
 *
 * The RLS policies read these transaction-local settings:
 *   app.farm_ids     User.farmId login slugs (OrgScope.farmIds)
 *   app.pond_ids     Pond ids (OrgScope.pondIds)
 *   app.user_id      User.id
 *   app.supabase_id  Supabase Auth user id
 *   app.org_ids      Organization ids (OrgScope.orgIds)
 *
 * `set_config(..., true)` is transaction-local, so pooled connections do not
 * leak one request's tenant into another. The settings and the queries they
 * scope share one transaction: `runWithTenant` opens it, applies the settings,
 * then publishes the transaction client through `AsyncLocalStorage` so
 * `tenantPrisma()` returns it for the rest of the unit of work.
 *
 * Today the app connects as `postgres` (`BYPASSRLS`), so these settings are
 * inert: nothing in this module makes RLS enforce anything. Enforcement begins
 * only when the connection role changes. Until then this module exists so a
 * converted slice already carries the right context on the day it does.
 *
 * See `docs/security/711-tenant-db-role-plan.md`.
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

/** Transaction budget shared by every tenant unit of work. */
export const TENANT_TRANSACTION_TIMEOUT_MS = 15_000;

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

type TenantStore = {
	context: TenantContext;
	tx: Prisma.TransactionClient;
};

/**
 * One store per async execution chain. A store is only ever created inside a
 * `runWithTenant` transaction callback, so `tenantPrisma()` outside one is a
 * programming error rather than a privileged fallback.
 */
const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Thrown when tenant data is requested without a context.
 *
 * This is deliberately fatal: a missing context means a caller reached tenant
 * data without declaring which tenant it is acting for, and silently falling
 * back to the privileged client would hide exactly the bug RLS is meant to
 * backstop.
 */
export class MissingTenantContextError extends Error {
	constructor() {
		super(
			"tenantPrisma() was called outside runWithTenant(): the request-scoped tenant " +
				"context is missing. Refusing to fall back to the privileged client. Wrap the " +
				"unit of work in runWithTenant(context, ...) and route tenant queries through " +
				"tenantPrisma().",
		);
		this.name = "MissingTenantContextError";
	}
}

/**
 * Run `work` in a transaction that carries the tenant context.
 *
 * The settings are applied on the same connection as the queries, and the
 * client is published to `tenantPrisma()` for the duration of `work`. Do not
 * nest this inside another Prisma transaction: a slice that already has a
 * transaction should call `applyTenantContext(tx, context)` and publish it with
 * `runWithTenantClient(tx, context, work)` instead.
 */
export async function runWithTenant<T>(
	context: TenantContext,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return prisma.$transaction(
		async (tx) => {
			await applyTenantContext(tx, context);
			return runWithTenantClient(tx, context, work);
		},
		{ timeout: TENANT_TRANSACTION_TIMEOUT_MS },
	);
}

/**
 * Publish an existing transaction as the tenant client for `work`.
 *
 * Use this only when the transaction was already opened by the caller; prefer
 * `runWithTenant`, which opens it and applies the settings in one step.
 */
export function runWithTenantClient<T>(
	tx: Prisma.TransactionClient,
	context: TenantContext,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return tenantStorage.run({ context, tx }, () => work(tx));
}

/**
 * The client bound to the current tenant context.
 *
 * Throws `MissingTenantContextError` when called outside `runWithTenant` (or
 * `runWithTenantClient`). There is no implicit fallback to the privileged
 * client on purpose.
 */
export function tenantPrisma(): Prisma.TransactionClient {
	const store = tenantStorage.getStore();
	if (!store) throw new MissingTenantContextError();
	return store.tx;
}

/** The active context, or null outside a tenant unit of work. Read-only. */
export function getTenantContext(): TenantContext | null {
	return tenantStorage.getStore()?.context ?? null;
}

/**
 * @deprecated Use `runWithTenant`. Kept for the existing Phase 2 callers and
 * its unit test; both names create the transaction and publish the context.
 */
export async function withTenant<T>(
	context: TenantContext,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return runWithTenant(context, work);
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
