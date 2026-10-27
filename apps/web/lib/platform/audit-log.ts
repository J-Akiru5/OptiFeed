import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { resolveDateRange, resolvePagination } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import type { Prisma } from "@prisma/client";

/**
 * Platform audit-log explorer (E16.4, task I-15).
 *
 * Read-only. Every entry point (`listPlatformAuditEntries`, `getAuditEntry`,
 * `getAuditFilterOptions`, and the CSV route) requires an active PlatformAdmin
 * row. Filters are built in one pure function so the page, the detail link and
 * the CSV export always agree on the same `where` clause; the CSV is streamed
 * in batches and hard-capped at `AUDIT_EXPORT_LIMIT` rows.
 *
 * The audit table is append-only. Nothing in this module writes to it.
 */

export const AUDIT_EXPORT_LIMIT = 5_000;
export const AUDIT_EXPORT_BATCH = 200;

export interface AuditFilters {
	action?: string;
	actor?: string;
	orgId?: string;
	targetType?: string;
	target?: string;
	from?: string;
	to?: string;
	page: number;
}

export interface AuditEntryRow {
	id: string;
	createdAt: Date;
	actorUserId: string;
	actorLabel: string;
	actorFarmId: string | null;
	action: string;
	targetType: string;
	targetId: string | null;
	orgId: string | null;
	orgName: string | null;
	reason: string;
	stepUpAt: Date | null;
	temporaryGrant: boolean;
	impersonationId: string | null;
}

export interface AuditEntryDetail extends AuditEntryRow {
	before: unknown;
	after: unknown;
	ip: string | null;
	userAgent: string | null;
}

export interface AuditListResult {
	rows: AuditEntryRow[];
	total: number;
	page: number;
	pageSize: number;
}

export interface AuditFilterOptions {
	orgs: { id: string; name: string }[];
	targetTypes: string[];
	actions: string[];
}

export interface AuditCsvRow {
	id: string;
	createdAt: Date;
	actorUserId: string;
	action: string;
	targetType: string;
	targetId: string | null;
	orgId: string | null;
	reason: string;
	ip: string | null;
	userAgent: string | null;
	before: unknown;
	after: unknown;
}

function first(value: string | string[] | undefined): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Read the explorer filters from a URL's search params. Bound lengths. */
export function parseAuditFilters(
	params: Record<string, string | string[] | undefined>,
): AuditFilters {
	const clamp = (value: string | undefined, max: number) =>
		value ? value.slice(0, max) : undefined;
	const pageValue = Number.parseInt(first(params.page) ?? "1", 10);

	return {
		action: clamp(first(params.action), 120),
		actor: clamp(first(params.actor), 120),
		orgId: clamp(first(params.org), 64),
		targetType: clamp(first(params.targetType), 64),
		target: clamp(first(params.target), 120),
		from: clamp(first(params.from), 10),
		to: clamp(first(params.to), 10),
		page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
	};
}

/**
 * The one `where` builder used by the list, the detail links and the CSV.
 *
 * `actorUserIds` is `null` when there is no actor filter, and an empty array
 * when the typed actor matched no user. An empty array must return nothing —
 * never the whole table — so it is mapped to an impossible id.
 */
export function buildPlatformAuditWhere(
	filters: AuditFilters,
	actorUserIds: string[] | null = null,
): Prisma.PlatformAuditLogWhereInput {
	const and: Prisma.PlatformAuditLogWhereInput[] = [];

	if (filters.action) {
		and.push({ action: { contains: filters.action, mode: "insensitive" } });
	}
	if (actorUserIds !== null) {
		and.push({ actorUserId: { in: actorUserIds.length > 0 ? actorUserIds : ["__no_match__"] } });
	}
	if (filters.orgId) and.push({ orgId: filters.orgId });
	if (filters.targetType) and.push({ targetType: filters.targetType });
	if (filters.target) {
		and.push({ targetId: { contains: filters.target, mode: "insensitive" } });
	}

	const range = resolveDateRange(filters.from, filters.to);
	if (range) and.push({ createdAt: range });

	return and.length > 0 ? { AND: and } : {};
}

/** Resolve a typed actor (farm id, email or display name) to user ids. */
export async function resolveAuditActorIds(actor: string): Promise<string[]> {
	const users = await prisma.user.findMany({
		where: {
			OR: [
				{ farmId: { contains: actor, mode: "insensitive" } },
				{ email: { contains: actor, mode: "insensitive" } },
				{ displayName: { contains: actor, mode: "insensitive" } },
			],
		},
		take: 50,
		select: { id: true },
	});
	return users.map((user) => user.id);
}

export async function listPlatformAuditEntries(filters: AuditFilters): Promise<AuditListResult> {
	await requirePlatformAdmin();

	const pageSize = await getListPageSize();
	const actorUserIds = filters.actor ? await resolveAuditActorIds(filters.actor) : null;
	const where = buildPlatformAuditWhere(filters, actorUserIds);

	const [total, firstFetch] = await Promise.all([
		prisma.platformAuditLog.count({ where }),
		prisma.platformAuditLog.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (filters.page - 1) * pageSize,
			take: pageSize,
			select: {
				id: true,
				createdAt: true,
				actorUserId: true,
				action: true,
				targetType: true,
				targetId: true,
				orgId: true,
				reason: true,
				stepUpAt: true,
				temporaryGrant: true,
				impersonationId: true,
			},
		}),
	]);

	const paging = resolvePagination(filters.page, pageSize, total);
	const rows =
		paging.page === filters.page
			? firstFetch
			: await prisma.platformAuditLog.findMany({
					where,
					orderBy: { createdAt: "desc" },
					skip: paging.offset,
					take: paging.pageSize,
					select: {
						id: true,
						createdAt: true,
						actorUserId: true,
						action: true,
						targetType: true,
						targetId: true,
						orgId: true,
						reason: true,
						stepUpAt: true,
						temporaryGrant: true,
						impersonationId: true,
					},
				});

	const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
	const orgIds = [...new Set(rows.flatMap((row) => (row.orgId ? [row.orgId] : [])))];
	const [actors, orgs] = await Promise.all([
		actorIds.length > 0
			? prisma.user.findMany({
					where: { id: { in: actorIds } },
					take: actorIds.length,
					select: { id: true, farmId: true, email: true, displayName: true },
				})
			: [],
		orgIds.length > 0
			? prisma.organization.findMany({
					where: { id: { in: orgIds } },
					take: orgIds.length,
					select: { id: true, name: true },
				})
			: [],
	]);
	const actorById = new Map(actors.map((actor) => [actor.id, actor]));
	const orgById = new Map(orgs.map((org) => [org.id, org]));

	return {
		rows: rows.map((row) => {
			const actor = actorById.get(row.actorUserId);
			return {
				...row,
				actorLabel: actor?.displayName || actor?.email || row.actorUserId,
				actorFarmId: actor?.farmId ?? null,
				orgName: row.orgId ? (orgById.get(row.orgId)?.name ?? null) : null,
			};
		}),
		total,
		page: paging.page,
		pageSize: paging.pageSize,
	};
}

export async function getAuditEntry(id: string): Promise<AuditEntryDetail | null> {
	await requirePlatformAdmin();

	if (!id || id.length > 64) return null;

	const row = await prisma.platformAuditLog.findUnique({
		where: { id },
		select: {
			id: true,
			createdAt: true,
			actorUserId: true,
			action: true,
			targetType: true,
			targetId: true,
			orgId: true,
			reason: true,
			stepUpAt: true,
			temporaryGrant: true,
			impersonationId: true,
			before: true,
			after: true,
			ip: true,
			userAgent: true,
		},
	});
	if (!row) return null;

	const [actor, org] = await Promise.all([
		prisma.user.findUnique({
			where: { id: row.actorUserId },
			select: { id: true, farmId: true, email: true, displayName: true },
		}),
		row.orgId
			? prisma.organization.findUnique({
					where: { id: row.orgId },
					select: { id: true, name: true },
				})
			: null,
	]);

	return {
		...row,
		actorLabel: actor?.displayName || actor?.email || row.actorUserId,
		actorFarmId: actor?.farmId ?? null,
		orgName: org?.name ?? null,
	};
}

/** Bounded option lists for the filter form. */
export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
	await requirePlatformAdmin();

	const [orgs, targetTypeGroups, actionGroups] = await Promise.all([
		prisma.organization.findMany({
			orderBy: { name: "asc" },
			take: 200,
			select: { id: true, name: true },
		}),
		prisma.platformAuditLog.groupBy({
			by: ["targetType"],
			_count: { _all: true },
			orderBy: { targetType: "asc" },
			take: 50,
		}),
		prisma.platformAuditLog.groupBy({
			by: ["action"],
			_count: { _all: true },
			orderBy: { action: "asc" },
			take: 100,
		}),
	]);

	return {
		orgs,
		targetTypes: targetTypeGroups.map((group) => group.targetType),
		actions: actionGroups.map((group) => group.action),
	};
}

/** One CSV batch, ordered the same way as the explorer. */
export async function fetchAuditExportRows(
	where: Prisma.PlatformAuditLogWhereInput,
	offset: number,
	take: number,
): Promise<AuditCsvRow[]> {
	return prisma.platformAuditLog.findMany({
		where,
		orderBy: { createdAt: "desc" },
		skip: offset,
		take: Math.max(0, Math.min(take, AUDIT_EXPORT_BATCH)),
		select: {
			id: true,
			createdAt: true,
			actorUserId: true,
			action: true,
			targetType: true,
			targetId: true,
			orgId: true,
			reason: true,
			ip: true,
			userAgent: true,
			before: true,
			after: true,
		},
	});
}

export const AUDIT_CSV_HEADER =
	"created_at,actor_user_id,action,target_type,target_id,org_id,reason,ip,user_agent,before,after\r\n";

function csvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text =
		typeof value === "string" || typeof value === "number" || typeof value === "boolean"
			? String(value)
			: JSON.stringify(value);
	// Spreadsheet formula injection: a cell that starts with these characters
	// would be evaluated by Excel/Sheets. Prefix an apostrophe so it stays text.
	const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** One CSV row (CRLF-terminated). */
export function toAuditCsvRow(row: AuditCsvRow): string {
	return `${[
		row.createdAt.toISOString(),
		row.actorUserId,
		row.action,
		row.targetType,
		row.targetId,
		row.orgId,
		row.reason,
		row.ip,
		row.userAgent,
		row.before,
		row.after,
	]
		.map(csvCell)
		.join(",")}\r\n`;
}

/**
 * Stream the filtered set as CSV, batch by batch, and stop at `limit`.
 *
 * Exported as a generator so the bound is unit-tested without a database: the
 * caller supplies `fetchBatch(offset, take)`.
 */
export async function* streamAuditCsv(
	fetchBatch: (offset: number, take: number) => Promise<AuditCsvRow[]>,
	limit: number = AUDIT_EXPORT_LIMIT,
): AsyncGenerator<string> {
	const safeLimit = Math.max(0, Math.min(limit, AUDIT_EXPORT_LIMIT));
	yield AUDIT_CSV_HEADER;

	let offset = 0;
	while (offset < safeLimit) {
		const take = Math.min(AUDIT_EXPORT_BATCH, safeLimit - offset);
		const rows = await fetchBatch(offset, take);
		if (rows.length === 0) return;
		yield rows.map(toAuditCsvRow).join("");
		offset += rows.length;
		if (rows.length < take) return;
	}
}
