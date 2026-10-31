import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Audit trail and history for database exports (issue #353).
 *
 * Every export attempt writes exactly one `PlatformAuditLog` row: who, when,
 * scope, per-table row counts, size, checksum and outcome. The row never
 * contains exported values — the summary describes the file, it is not a copy
 * of it. A failed or cancelled attempt writes a row too, so a truncated
 * download is visible instead of silent.
 *
 * The same rows feed the Backup page: the tenant page lists exports that
 * touched one of the caller's organizations (plus their own attempts), and the
 * platform page lists every export.
 */

export const BACKUP_EXPORT_ACTION = "backup.export";
export const BACKUP_EXPORT_TARGET_TYPE = "backup_export";
export const BACKUP_HISTORY_LIMIT = 20;

export type BackupExportOutcome = "succeeded" | "failed" | "cancelled";
export type BackupExportScopeKind = "platform" | "tenant";

/** The `after` payload of an export audit row. Never contains row data. */
export interface BackupExportSummary {
	scope: BackupExportScopeKind;
	format: "sql";
	outcome: BackupExportOutcome;
	filename: string;
	bytes: number;
	sha256: string | null;
	totalRows: number;
	tables: Record<string, number>;
	orgIds: string[];
	orgNames: string[];
	error: string | null;
}

export interface RecordBackupExportInput {
	actorUserId: string;
	/** The organization this export is filed under; null when it spans several. */
	orgId: string | null;
	reason: string;
	stepUpAt: Date | null;
	temporaryGrant: boolean;
	ip: string | null;
	userAgent: string | null;
	summary: BackupExportSummary;
}

export interface BackupExportRecord extends BackupExportSummary {
	id: string;
	createdAt: Date;
	actorUserId: string;
	actorLabel: string;
	actorFarmId: string | null;
	orgId: string | null;
	reason: string;
	stepUpAt: Date | null;
}

/** Append the audit row for one export attempt. */
export async function recordBackupExport(input: RecordBackupExportInput): Promise<void> {
	await prisma.platformAuditLog.create({
		data: {
			actorUserId: input.actorUserId,
			action: BACKUP_EXPORT_ACTION,
			targetType: BACKUP_EXPORT_TARGET_TYPE,
			targetId: input.summary.filename,
			orgId: input.orgId,
			reason: input.reason,
			stepUpAt: input.stepUpAt,
			temporaryGrant: input.temporaryGrant,
			ip: input.ip,
			userAgent: input.userAgent,
			after: input.summary as unknown as Prisma.InputJsonValue,
		},
	});
}

/**
 * Best-effort audit write: a failure to record must never turn a completed
 * download into an error, and must never swallow the original error.
 */
export async function recordBackupExportSafely(input: RecordBackupExportInput): Promise<void> {
	try {
		await recordBackupExport(input);
	} catch (error) {
		console.error("[backup] the export audit row could not be written:", error);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function asCounts(value: unknown): Record<string, number> {
	const record = asRecord(value);
	const counts: Record<string, number> = {};
	for (const [key, count] of Object.entries(record)) {
		if (typeof count === "number" && Number.isFinite(count)) counts[key] = count;
	}
	return counts;
}

function asScope(value: unknown): BackupExportScopeKind {
	return value === "platform" ? "platform" : "tenant";
}

function asOutcome(value: unknown): BackupExportOutcome {
	if (value === "succeeded" || value === "cancelled") return value;
	return "failed";
}

/** Parse a stored `after` payload defensively (the column is free-form JSON). */
export function parseBackupSummary(value: unknown): BackupExportSummary | null {
	const record = asRecord(value);
	const filename = asString(record.filename);
	if (!filename) return null;
	return {
		scope: asScope(record.scope),
		format: "sql",
		outcome: asOutcome(record.outcome),
		filename,
		bytes: asNumber(record.bytes),
		sha256: typeof record.sha256 === "string" ? record.sha256 : null,
		totalRows: asNumber(record.totalRows),
		tables: asCounts(record.tables),
		orgIds: asStrings(record.orgIds),
		orgNames: asStrings(record.orgNames),
		error: typeof record.error === "string" ? record.error : null,
	};
}

/**
 * Past exports, newest first.
 *
 * A tenant scope passes its organization ids: the list then contains exports
 * that covered one of those organizations, plus the caller's own attempts (an
 * export spanning several organizations is filed with `orgId = null`). The
 * platform page passes no ids and sees everything.
 */
export async function listBackupExports(options: {
	orgIds?: readonly string[] | null;
	actorUserId: string;
	take?: number;
}): Promise<BackupExportRecord[]> {
	const where: Prisma.PlatformAuditLogWhereInput = {
		action: BACKUP_EXPORT_ACTION,
		...(options.orgIds
			? {
					OR: [{ orgId: { in: [...options.orgIds] } }, { actorUserId: options.actorUserId }],
				}
			: {}),
	};

	const rows = await prisma.platformAuditLog.findMany({
		where,
		orderBy: { createdAt: "desc" },
		take: Math.max(1, Math.min(options.take ?? BACKUP_HISTORY_LIMIT, 100)),
		select: {
			id: true,
			createdAt: true,
			actorUserId: true,
			orgId: true,
			reason: true,
			stepUpAt: true,
			after: true,
		},
	});

	const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
	const actors =
		actorIds.length > 0
			? await prisma.user.findMany({
					where: { id: { in: actorIds } },
					take: actorIds.length,
					select: { id: true, farmId: true, email: true, displayName: true },
				})
			: [];
	const actorById = new Map(actors.map((actor) => [actor.id, actor]));

	return rows.flatMap((row) => {
		const summary = parseBackupSummary(row.after);
		if (!summary) return [];
		const actor = actorById.get(row.actorUserId);
		return [
			{
				...summary,
				id: row.id,
				createdAt: row.createdAt,
				actorUserId: row.actorUserId,
				actorLabel: actor?.displayName || actor?.email || row.actorUserId,
				actorFarmId: actor?.farmId ?? null,
				orgId: row.orgId,
				reason: row.reason,
				stepUpAt: row.stepUpAt,
			},
		];
	});
}
