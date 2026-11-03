import { createHash } from "node:crypto";
import { badRequest, notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import { type ExportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { coerceCell } from "@/lib/xlsx/schema";
import { CSV_EXPORT_TYPES } from "./export-data";

export interface ImportResult {
	importedCount: number;
}

export interface ConfirmImportOptions {
	/** Client-supplied `Idempotency-Key`; when absent the payload is hashed. */
	idempotencyKey?: string | null;
}

/** Requests above this size are refused before parsing (5 MB). */
export const MAX_CSV_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Resolve the key that makes one confirm retry-safe (#723).
 *
 * An explicit client key wins. Without one — the legacy synchronous route, a
 * queued job from an older client, the current UI — the canonical type and CSV
 * are hashed so a double submit still resolves to the same key. The prefix
 * keeps a derived key separate from a client key that happens to be 64 hex
 * characters.
 */
function resolveImportIdempotencyKey(
	type: ExportableType,
	csvData: string,
	supplied?: string | null,
): string {
	const explicit = supplied?.trim();
	if (explicit) return explicit;
	const digest = createHash("sha256").update(type).update("\0").update(csvData).digest("hex");
	return `payload-sha256:${digest}`;
}

/**
 * A stored result is returned as-is. A malformed row must not re-run the
 * insert: the imported rows may already be committed, so correctness beats
 * reporting a count we cannot reconstruct.
 */
function storedImportResult(value: unknown): ImportResult {
	const importedCount =
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { importedCount?: unknown }).importedCount === "number"
			? (value as { importedCount: number }).importedCount
			: 0;
	return { importedCount };
}

/** Prisma reports P2002; a raw PostgreSQL driver can surface 23505. */
function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const record = error as { code?: unknown; meta?: { code?: unknown } };
	return record.code === "P2002" || record.code === "23505" || record.meta?.code === "23505";
}

function numberField(
	row: Record<string, unknown>,
	field: string,
	index: number,
	options: { positive?: boolean; integer?: boolean; min?: number } = {},
): number {
	const value = Number(row[field] ?? 0);
	const invalid =
		!Number.isFinite(value) ||
		(options.positive === true && value <= 0) ||
		(options.integer === true && !Number.isInteger(value)) ||
		(options.min !== undefined && value < options.min);
	if (invalid) throw badRequest(`Row ${index + 1}: ${field} is invalid.`);
	return value;
}

function dateField(row: Record<string, unknown>, field: string, index: number): Date {
	const value = new Date(String(row[field]));
	if (Number.isNaN(value.getTime()))
		throw badRequest(`Row ${index + 1}: ${field} is not a valid date.`);
	return value;
}

/**
 * A flag column. The CSV reader keeps every cell as text, and `Boolean("false")`
 * is `true`, so the value is read the way the preview reads it (TRUE/FALSE, 1/0,
 * yes/no). An empty cell is `null`; anything else is a 400 naming the row.
 */
function booleanField(row: Record<string, unknown>, field: string, index: number): boolean | null {
	const result = coerceCell(row[field], "boolean");
	if (!result.ok) throw badRequest(`Row ${index + 1}: ${field} ${result.message}.`);
	return result.value as boolean | null;
}

/**
 * An optional date column: absent stays absent, but a value that is present and
 * unparseable is a 400. Passing `Invalid Date` to Prisma used to surface as a
 * 500 with no indication of which row was wrong.
 */
function optionalDateField(
	row: Record<string, unknown>,
	field: string,
	index: number,
): Date | null {
	const raw = row[field];
	if (raw === null || raw === undefined || String(raw).trim() === "") return null;
	return dateField(row, field, index);
}

/**
 * Validate and apply a CSV import in one bounded transaction.
 *
 * Extracted from the synchronous route so the same implementation runs in the
 * background worker. Callers enforce write access before enqueuing the job;
 * the worker re-resolves the owner's active pond and re-checks ownership of
 * referenced rows.
 *
 * Idempotent by `options.idempotencyKey` (#723): the confirmation row is
 * created in the same transaction as the imported rows, so a replay returns
 * the first result, a failed import can be retried with the same key, and a
 * concurrent duplicate loses the unique race without committing its rows.
 */
export async function confirmImport(
	ownerId: string,
	type: ExportableType,
	csvData: string,
	options: ConfirmImportOptions = {},
): Promise<ImportResult> {
	// The value arrives from a request body or a queued job payload, so it is not
	// trustworthy just because the type says so. Without this check an unknown
	// type matched no switch case and reported a successful zero-row import
	// (plus a misleading `data_imported` audit row).
	if (!CSV_EXPORT_TYPES.includes(type)) {
		throw badRequest("Unknown import type.");
	}

	const idempotencyKey = resolveImportIdempotencyKey(type, csvData, options.idempotencyKey);
	const idempotencyWhere = { ownerId_idempotencyKey: { ownerId, idempotencyKey } };

	// A replay needs no pond, parse or transaction: the winning result is the
	// only thing the caller is owed.
	const existing = await prisma.importConfirmation.findUnique({
		where: idempotencyWhere,
		select: { result: true },
	});
	if (existing) return storedImportResult(existing.result);

	const pond = await resolveActivePond(ownerId);
	if (!pond) throw notFound("No pond found.");

	const { data } = parseCsvString(csvData);
	if (data.length > IMPORT_ROW_LIMIT) {
		throw badRequest(`Import exceeds the ${IMPORT_ROW_LIMIT} row limit.`);
	}

	const device = await prisma.energyDevice.findFirst({
		where: { pondId: pond.id },
		orderBy: { createdAt: "asc" },
	});

	// F-004 ownership check runs before the transaction so a foreign id can
	// still return a 400 directly (a return inside the tx callback would be
	// swallowed by the transaction wrapper).
	if (type === "fish_samples") {
		const referencedIds = [...new Set(data.map((row) => String(row.biomassLogId)))];
		const ownedLogs = await prisma.biomassLog.findMany({
			where: { id: { in: referencedIds }, pond: { ownerId } },
			select: { id: true },
		});
		const ownedIds = new Set(ownedLogs.map((log) => log.id));
		if (referencedIds.some((id) => !ownedIds.has(id))) {
			throw badRequest("One or more biomassLogId values are not owned by this farm.");
		}
	}

	const pending = prisma.$transaction(
		async (tx) => {
			let count = 0;

			switch (type) {
				case "biomass_logs": {
					const rows = data.map((row, index) => {
						const sampleWeightKg = numberField(row, "sampleWeightKg", index, { positive: true });
						const sampleCount = numberField(row, "sampleCount", index, {
							positive: true,
							integer: true,
						});
						const sampleLengthCm = numberField(row, "sampleLengthCm", index, { min: 0 });
						const avgWeightKg = sampleWeightKg / sampleCount;
						return {
							pondId: pond.id,
							sampleWeightKg,
							sampleLengthCm,
							sampleCount,
							avgWeightKg,
							source: "import",
							recordedAt: optionalDateField(row, "recordedAt", index) ?? new Date(),
						};
					});
					count = (await tx.biomassLog.createMany({ data: rows })).count;
					break;
				}
				case "fish_samples": {
					const rows = data.map((row, index) => ({
						biomassLogId: String(row.biomassLogId),
						weightGrams: numberField(row, "weightGrams", index, { positive: true }),
						lengthCm: numberField(row, "lengthCm", index, { min: 0 }),
					}));
					count = (await tx.fishSample.createMany({ data: rows })).count;
					break;
				}
				case "feed_events": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row, index) => ({
						deviceId: device.id,
						eventId: row.eventId ? String(row.eventId) : undefined,
						eventType: String(row.eventType),
						timestamp: String(row.timestamp ?? "unknown"),
						grams:
							row.grams != null && String(row.grams).trim() !== ""
								? numberField(row, "grams", index, { min: 0 })
								: null,
						source: row.source ? String(row.source) : null,
						feedRequestId: row.feedRequestId ? String(row.feedRequestId) : null,
						commandId: row.commandId ? String(row.commandId) : null,
						rtcOk: booleanField(row, "rtcOk", index),
						feederActive: booleanField(row, "feederActive", index),
						receivedAt: optionalDateField(row, "receivedAt", index) ?? new Date(),
						// #709: mark imported rows so they are distinguishable from real
						// telemetry instead of inheriting the `device` default.
						dataSource: "import",
					}));
					count = (await tx.feedEvent.createMany({ data: rows })).count;
					break;
				}
				case "fcr_reports": {
					const rows = data.map((row, index) => ({
						pondId: pond.id,
						periodStart: dateField(row, "periodStart", index),
						periodEnd: dateField(row, "periodEnd", index),
						totalFeedKg: numberField(row, "totalFeedKg", index, { min: 0 }),
						biomassGainKg: numberField(row, "biomassGainKg", index, { min: 0 }),
						fcrValue: numberField(row, "fcrValue", index, { min: 0 }),
					}));
					count = (await tx.fcrReport.createMany({ data: rows })).count;
					break;
				}
				case "feed_level_logs": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row, index) => ({
						deviceId: device.id,
						levelPercent: numberField(row, "levelPercent", index, { min: 0 }),
						distanceCm: numberField(row, "distanceCm", index, { min: 0 }),
						recordedAt: optionalDateField(row, "recordedAt", index) ?? new Date(),
						// #709: imported history is not a device reading.
						dataSource: "import",
					}));
					count = (await tx.feedLevelLog.createMany({ data: rows })).count;
					break;
				}
				case "notifications": {
					const rows = data.map((row, index) => ({
						pondId: pond.id,
						tier: String(row.tier),
						message: String(row.message),
						linkTo: row.linkTo ? String(row.linkTo) : null,
						read: booleanField(row, "read", index) ?? false,
						category: row.category ? String(row.category) : null,
						autoCleared: booleanField(row, "autoCleared", index) ?? false,
						createdAt: optionalDateField(row, "createdAt", index) ?? new Date(),
					}));
					count = (await tx.notification.createMany({ data: rows })).count;
					break;
				}
				case "audit_events": {
					if (!device) throw new Error("No device found");
					const rows = data.map((row, index) => {
						let metadata = null;
						if (row.metadata) {
							try {
								metadata = JSON.parse(String(row.metadata));
							} catch {
								metadata = { raw: row.metadata };
							}
						}
						return {
							deviceId: device.id,
							eventType: String(row.eventType),
							source: String(row.source),
							actorId: row.actorId ? String(row.actorId) : null,
							metadata,
							deviceTime: row.deviceTime ? String(row.deviceTime) : null,
							createdAt: optionalDateField(row, "createdAt", index) ?? new Date(),
						};
					});
					count = (await tx.deviceStateEvent.createMany({ data: rows })).count;
					break;
				}
			}

			// deviceId is a required FK (not nullable, no default) — skip the
			// audit event when the pond has no device rather than writing ""
			// and failing the whole transaction after the bulk insert.
			if (device) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: device.id,
						eventType: "data_imported",
						source: "user",
						actorId: ownerId,
						metadata: { type, count },
					},
				});
			}

			// Same transaction as the rows: a failure rolls this back so the key
			// is not consumed, and the unique index commits only with the data.
			await tx.importConfirmation.create({
				data: {
					ownerId,
					idempotencyKey,
					type,
					result: { importedCount: count },
				},
			});

			return count;
		},
		{ timeout: 30_000 },
	);

	let importedCount: number;
	try {
		importedCount = await pending;
	} catch (error) {
		// Two confirms raced past the lookup. The unique index let exactly one
		// commit; the loser's transaction (including its rows) rolled back, so
		// return the winner's result instead of inserting a second copy.
		if (isUniqueViolation(error)) {
			const winner = await prisma.importConfirmation.findUnique({
				where: idempotencyWhere,
				select: { result: true },
			});
			if (winner) return storedImportResult(winner.result);
		}
		throw error;
	}

	return { importedCount };
}
