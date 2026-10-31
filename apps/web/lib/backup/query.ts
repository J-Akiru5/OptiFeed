import type { ExportScope, TenantExportScope } from "./scope";
import type { BackupRow, BackupTable } from "./tables";

/**
 * One narrow adapter between the promote-time allow-list and Prisma.
 *
 * Each model has its own generated `findMany`/`count` argument type, so the
 * delegates cannot be held in one typed collection. The cast below is the only
 * place where a delegate is widened, and it is safe because the only arguments
 * this module builds are ones every delegate accepts: `where`, `orderBy` on the
 * declared key, `cursor`/`skip`/`take`, and a `select` built from the table's
 * own columns (the allow-list test proves those columns exist).
 */

interface BackupDelegate {
	count(args: { where?: Record<string, unknown> }): Promise<number>;
	findMany(args: Record<string, unknown>): Promise<BackupRow[]>;
}

function delegateOf(table: BackupTable): BackupDelegate {
	return table.model as unknown as BackupDelegate;
}

/** The `where` clause for a scope. Platform scope has no predicate. */
export function scopeWhere(
	table: BackupTable,
	scope: ExportScope,
): Record<string, unknown> | undefined {
	return scope.kind === "platform" ? undefined : table.tenantWhere(scope as TenantExportScope);
}

/** Number of rows the table contributes to this export. */
export async function countTableRows(table: BackupTable, scope: ExportScope): Promise<number> {
	return delegateOf(table).count({ where: scopeWhere(table, scope) });
}

function selectFor(table: BackupTable): Record<string, boolean> {
	return Object.fromEntries(table.columns.map((column) => [column, true]));
}

/** One keyset page, oldest id first, selecting only allow-listed columns. */
export async function fetchTablePage(
	table: BackupTable,
	scope: ExportScope,
	cursor: string | null,
	take: number,
): Promise<BackupRow[]> {
	const page = Math.max(1, Math.floor(take));
	return delegateOf(table).findMany({
		where: scopeWhere(table, scope),
		orderBy: { [table.key]: "asc" },
		take: page,
		...(cursor
			? {
					cursor: { [table.key]: cursor },
					skip: 1,
				}
			: {}),
		select: selectFor(table),
	});
}
