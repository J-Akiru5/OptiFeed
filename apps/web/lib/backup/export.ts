import { type BackupExportSummary, recordBackupExportSafely } from "./audit";
import {
	BACKUP_EXPORT_BATCH,
	BACKUP_EXPORT_MAX_BYTES,
	BACKUP_EXPORT_MAX_ROWS,
	BACKUP_EXPORT_TIMEOUT_MS,
	BACKUP_TRAILER_MARKER,
} from "./constants";
import { buildIdentityManifest, renderIdentityManifest } from "./identity";
import { countTableRows, fetchTablePage } from "./query";
import type { ExportScope } from "./scope";
import {
	createExportDigest,
	exportCommit,
	exportHeader,
	exportSummary,
	exportTrailer,
	insertStatement,
	tableHeader,
} from "./sql";
import { type BackupRow, type BackupTable, tablesForScope } from "./tables";

/**
 * The database export pipeline (issue #353).
 *
 * 1. Count the rows in scope. The count is the size gate: too large is a clear
 *    HTTP 413 before a single byte is written, not a truncated download.
 * 2. Stream one table at a time, one batch per query, only allow-listed columns.
 * 3. Hash and count bytes as they are produced; cap both.
 * 4. Write exactly one audit row when the attempt settles — succeeded, failed
 *    or cancelled — and never with row data.
 */

/** A row cap breach, detected before streaming starts. */
export class BackupExportTooLargeError extends Error {
	readonly limit: number;
	readonly observed: number;

	constructor(observed: number, limit: number = BACKUP_EXPORT_MAX_ROWS) {
		super(
			`This export would contain ${observed.toLocaleString("en-US")} rows, over the ${limit.toLocaleString("en-US")}-row limit. Nothing was downloaded.`,
		);
		this.name = "BackupExportTooLargeError";
		this.limit = limit;
		this.observed = observed;
	}
}

/** The streaming byte cap was exceeded. */
export class BackupExportByteCapError extends Error {
	constructor(limitBytes: number = BACKUP_EXPORT_MAX_BYTES) {
		super(
			`The export passed its ${Math.floor(limitBytes / (1024 * 1024))} MB size limit and was stopped. The partial file is incomplete; do not restore it.`,
		);
		this.name = "BackupExportByteCapError";
	}
}

/** The streaming budget was exceeded. */
export class BackupExportTimeoutError extends Error {
	constructor(limitMs: number = BACKUP_EXPORT_TIMEOUT_MS) {
		super(
			`The export exceeded its ${Math.round(limitMs / 1000)} s budget and was stopped. Nothing complete was downloaded; try again when the database is quieter.`,
		);
		this.name = "BackupExportTimeoutError";
	}
}

export interface BackupExportRequest {
	scope: ExportScope;
	actorUserId: string;
	/** What the audit and the file header call the requester. Never an email alone. */
	actorLabel: string;
	reason: string;
	stepUpAt: Date | null;
	temporaryGrant: boolean;
	origin: { ip: string | null; userAgent: string | null };
	now?: Date;
}

export interface PreparedBackupExport {
	tables: readonly BackupTable[];
	counts: Record<string, number>;
	totalRows: number;
	filename: string;
}

function twoDigits(value: number): string {
	return String(value).padStart(2, "0");
}

/** `tenant-20261031-1530`: UTC, collision-resistant enough for a download name. */
export function backupFilename(scopeKind: "platform" | "tenant", now: Date): string {
	const stamp = `${now.getUTCFullYear()}${twoDigits(now.getUTCMonth() + 1)}${twoDigits(
		now.getUTCDate(),
	)}-${twoDigits(now.getUTCHours())}${twoDigits(now.getUTCMinutes())}`;
	return `pakaonai-backup-${scopeKind}-${stamp}.sql`;
}

/** Count every included table in parallel and apply the row cap. */
export async function prepareBackupExport(
	scope: ExportScope,
	now: Date = new Date(),
): Promise<PreparedBackupExport> {
	const tables = tablesForScope(scope.kind);
	const counts: Record<string, number> = {};
	const results = await Promise.all(
		tables.map(async (table) => ({ name: table.name, count: await countTableRows(table, scope) })),
	);
	let totalRows = 0;
	for (const result of results) {
		counts[result.name] = result.count;
		totalRows += result.count;
	}
	if (totalRows > BACKUP_EXPORT_MAX_ROWS) {
		throw new BackupExportTooLargeError(totalRows);
	}
	return { tables, counts, totalRows, filename: backupFilename(scope.kind, now) };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Build the streamed response.
 *
 * The returned body is a `ReadableStream` over SQL text. Its generator owns the
 * audit write so a cancelled download is still recorded; the route never
 * buffers the database in memory.
 */
export function createBackupExportResponse(
	request: BackupExportRequest,
	prepared: PreparedBackupExport,
): Response {
	const now = request.now ?? new Date();
	const orgId =
		request.scope.kind === "tenant" && request.scope.orgIds.length === 1
			? request.scope.orgIds[0]
			: null;
	const orgIds = request.scope.kind === "tenant" ? request.scope.orgIds : [];
	const orgNames = request.scope.kind === "tenant" ? request.scope.orgNames : [];

	const emitted: Record<string, number> = {};
	const state: { sha256: string | null; bytes: number } = { sha256: null, bytes: 0 };
	let settled = false;

	const settle = async (outcome: BackupExportSummary["outcome"], error: string | null) => {
		if (settled) return;
		settled = true;
		await recordBackupExportSafely({
			actorUserId: request.actorUserId,
			orgId,
			reason: request.reason,
			stepUpAt: request.stepUpAt,
			temporaryGrant: request.temporaryGrant,
			ip: request.origin.ip,
			userAgent: request.origin.userAgent,
			summary: {
				scope: request.scope.kind,
				format: "sql",
				outcome,
				filename: prepared.filename,
				bytes: state.bytes,
				sha256: state.sha256,
				totalRows: Object.values(emitted).reduce((sum, count) => sum + count, 0),
				tables: { ...emitted },
				orgIds,
				orgNames,
				error,
			},
		});
	};

	async function* generate(): AsyncGenerator<Uint8Array> {
		const digest = createExportDigest();
		const deadline = Date.now() + BACKUP_EXPORT_TIMEOUT_MS;
		const identityUsers: BackupRow[] = [];
		const identityMemberships: BackupRow[] = [];

		try {
			yield digest.update(
				exportHeader({
					scope: request.scope.kind,
					actor: request.actorLabel,
					reason: request.reason,
					orgNames,
					generatedAt: now,
				}),
			);

			for (const table of prepared.tables) {
				yield digest.update(tableHeader(table, prepared.counts[table.name] ?? 0));
				let cursor: string | null = null;

				for (;;) {
					if (Date.now() > deadline) throw new BackupExportTimeoutError();

					const rows = await fetchTablePage(table, request.scope, cursor, BACKUP_EXPORT_BATCH);
					if (rows.length === 0) break;

					if (table.name === "User") identityUsers.push(...rows);
					if (table.name === "Membership") identityMemberships.push(...rows);

					let text = "";
					for (const row of rows) text += insertStatement(table, row);
					emitted[table.name] = (emitted[table.name] ?? 0) + rows.length;
					yield digest.update(text);

					if (digest.bytes() > BACKUP_EXPORT_MAX_BYTES) {
						throw new BackupExportByteCapError();
					}
					if (rows.length < BACKUP_EXPORT_BATCH) break;
					cursor = String(rows[rows.length - 1][table.key]);
				}
			}

			yield digest.update(exportSummary(emitted));
			yield digest.update(
				renderIdentityManifest(buildIdentityManifest(identityUsers, identityMemberships)),
			);
			// COMMIT; belongs to the hashed payload: the restore check hashes
			// everything before the trailer marker and must see the commit.
			yield digest.update(exportCommit());

			state.sha256 = digest.hex();
			state.bytes = digest.bytes();
			// The trailer is written after the hash, so it is not part of it.
			yield new TextEncoder().encode(exportTrailer(state.sha256, state.bytes));

			await settle("succeeded", null);
		} catch (error) {
			await settle("failed", errorMessage(error));
			throw error;
		} finally {
			// A client that disconnects cancels the generator without an error.
			await settle("cancelled", "The download was cancelled before it finished.");
		}
	}

	const iterator = generate();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) {
					controller.close();
					return;
				}
				controller.enqueue(next.value);
			} catch (error) {
				// Headers are already sent: break the stream instead of serving a
				// silently truncated file.
				controller.error(error);
			}
		},
		async cancel() {
			await iterator.return(undefined);
		},
	});

	return new Response(body, {
		headers: {
			"Content-Type": "application/sql; charset=utf-8",
			"Content-Disposition": `attachment; filename="${prepared.filename}"`,
			"Cache-Control": "no-store",
			"X-Backup-Scope": request.scope.kind,
			"X-Backup-Tables": String(prepared.tables.length),
			"X-Backup-Rows": String(prepared.totalRows),
			"X-Backup-Row-Limit": String(BACKUP_EXPORT_MAX_ROWS),
			"X-Backup-Size-Limit": String(BACKUP_EXPORT_MAX_BYTES),
			"X-Backup-Checksum-Marker": BACKUP_TRAILER_MARKER,
		},
	});
}
