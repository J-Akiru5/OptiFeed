import { createHash } from "node:crypto";
import { badRequest, notFound } from "@/lib/api/errors";
import { resolveActivePond } from "@/lib/auth/pond-access";
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import { IMPORTABLE_TYPES, type ImportableType, parseCsvString } from "@/lib/csv";
import prisma from "@/lib/prisma";
import { coerceCell } from "@/lib/xlsx/schema";

export interface ImportResult {
	importedCount: number;
}

export interface ConfirmImportOptions {
	/** Client-supplied `Idempotency-Key`; when absent the payload is hashed. */
	idempotencyKey?: string | null;
	/**
	 * Pond every imported row is written to (#743). Captured when the preview is
	 * prepared, so switching the active pond before confirming cannot retarget
	 * the import. Resolved and ownership-checked on every confirm.
	 */
	pondId?: string | null;
	/**
	 * Prisma interactive-transaction budget (#758). The worker sets this below
	 * its own job limit so a transaction cannot commit after the job has been
	 * reported failed.
	 */
	transactionTimeoutMs?: number;
}

/** Requests above this size are refused before parsing (5 MB). */
export const MAX_CSV_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Default import transaction budget (#758).
 *
 * The import job's wall-clock limit is 12 s. Prisma aborts an interactive
 * transaction that runs past `timeout`, so an 8 s budget leaves four seconds
 * for the rollback to reach the database before `withTimeLimit` can fail the
 * job. With the previous 30 s budget the job was marked failed first and the
 * transaction still committed, so a retry duplicated every row.
 */
export const IMPORT_TRANSACTION_TIMEOUT_MS = 8_000;

/** The rollback must still have time to land before the job limit. */
const IMPORT_TRANSACTION_MARGIN_MS = 4_000;
const MIN_IMPORT_TRANSACTION_TIMEOUT_MS = 500;

/** A transaction budget that is always shorter than the job that owns it. */
export function importTransactionTimeoutMs(jobLimitMs: number): number {
	const budget = Number.isFinite(jobLimitMs)
		? jobLimitMs - IMPORT_TRANSACTION_MARGIN_MS
		: IMPORT_TRANSACTION_TIMEOUT_MS;
	return Math.max(
		MIN_IMPORT_TRANSACTION_TIMEOUT_MS,
		Math.min(IMPORT_TRANSACTION_TIMEOUT_MS, budget),
	);
}

/**
 * Resolve the key that makes one confirm retry-safe (#723).
 *
 * An explicit client key wins. Without one — the legacy synchronous route, a
 * queued job from an older client, the current UI — the canonical type, CSV and
 * (from #743) the target pond are hashed so a double submit still resolves to
 * the same key. The pond is part of the hash because importing the same file
 * into a second pond is a different action; omitting it would return the first
 * pond's result instead. A payload without an explicit pond keeps the original
 * type+CSV hash, so an in-flight pre-#743 retry still matches its stored row.
 * The prefix keeps a derived key separate from a client key that happens to be
 * 64 hex characters.
 */
function resolveImportIdempotencyKey(
	type: ImportableType,
	csvData: string,
	pondId: string | null,
	supplied?: string | null,
): string {
	const explicit = supplied?.trim();
	if (explicit) return explicit;
	const digest = createHash("sha256").update(type).update("\0").update(csvData);
	if (pondId) digest.update("\0").update(pondId);
	return `payload-sha256:${digest.digest("hex")}`;
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

/** An optional id column: absent or blank means "fall back", never the literal "undefined". */
function trimmedField(row: Record<string, unknown>, field: string): string {
	const value = row[field];
	return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Validate and apply a CSV import in one bounded transaction.
 *
 * Extracted from the synchronous route so the same implementation runs in the
 * background worker. Callers enforce write access before enqueuing the job; the
 * worker re-resolves the target pond from the payload and re-checks ownership of
 * referenced ponds, devices and biomass logs. Resolving the active pond here
 * instead would let a pond switch between preview and confirm retarget the
 * import (#743).
 *
 * Idempotent by `options.idempotencyKey` (#723): the confirmation row is
 * created in the same transaction as the imported rows, so a replay returns
 * the first result, a failed import can be retried with the same key, and a
 * concurrent duplicate loses the unique race without committing its rows.
 */
export async function confirmImport(
	ownerId: string,
	type: ImportableType,
	csvData: string,
	options: ConfirmImportOptions = {},
): Promise<ImportResult> {
	// The value arrives from a request body or a queued job payload, so it is not
	// trustworthy just because the type says so. Without this check an unknown
	// type matched no switch case and reported a successful zero-row import
	// (plus a misleading `data_imported` audit row). Audit events are not
	// importable at all (#744).
	if (!IMPORTABLE_TYPES.includes(type)) {
		throw badRequest("Unknown import type.");
	}

	// An explicit pond is resolved before the replay lookup: a caller must not
	// learn a stored result for a pond they no longer own, and the pond is part
	// of the derived idempotency key.
	const requestedPondId = options.pondId?.trim() || null;
	const requestedPond = requestedPondId ? await resolveActivePond(ownerId, requestedPondId) : null;
	if (requestedPondId && !requestedPond) throw notFound("Pond not found.");

	const idempotencyKey = resolveImportIdempotencyKey(
		type,
		csvData,
		requestedPondId,
		options.idempotencyKey,
	);
	const idempotencyWhere = { ownerId_idempotencyKey: { ownerId, idempotencyKey } };

	// A replay needs no parse or transaction: the winning result is the only
	// thing the caller is owed.
	const existing = await prisma.importConfirmation.findUnique({
		where: idempotencyWhere,
		select: { result: true },
	});
	if (existing) return storedImportResult(existing.result);

	// Legacy callers without an explicit pond keep the old "active pond at
	// confirm time" behaviour. The UI always supplies the pond captured at
	// preview time.
	const pond = requestedPond ?? (await resolveActivePond(ownerId));
	if (!pond) throw notFound("No pond found.");

	const { data } = parseCsvString(csvData);
	if (data.length > IMPORT_ROW_LIMIT) {
		throw badRequest(`Import exceeds the ${IMPORT_ROW_LIMIT} row limit.`);
	}

	// A file exported from another pond names that pond in every row. Writing
	// those rows into the selected pond would silently merge two ponds' history,
	// so a present, different id is a 400 that names the row.
	data.forEach((row, index) => {
		const rowPondId = trimmedField(row, "pondId");
		if (rowPondId !== "" && rowPondId !== pond.id) {
			throw badRequest(`Row ${index + 1}: pondId does not match the selected pond.`);
		}
	});

	const devices = await prisma.energyDevice.findMany({
		where: { pondId: pond.id },
		select: { id: true },
		orderBy: { createdAt: "asc" },
		take: 100,
	});
	const pondDeviceIds = new Set(devices.map((entry) => entry.id));
	const defaultDeviceId = devices[0]?.id ?? null;

	// Device rows follow the same rule: a device from another pond is rejected
	// instead of being silently remapped to this pond's first feeder. A blank
	// deviceId still falls back to that feeder for hand-built files.
	if (type === "feed_events" || type === "feed_level_logs") {
		data.forEach((row, index) => {
			const rowDeviceId = trimmedField(row, "deviceId");
			if (rowDeviceId !== "" && !pondDeviceIds.has(rowDeviceId)) {
				throw badRequest(`Row ${index + 1}: deviceId does not belong to the selected pond.`);
			}
		});
	}

	// F-004 ownership check runs before the transaction so a foreign id can
	// still return a 400 directly (a return inside the tx callback would be
	// swallowed by the transaction wrapper). Scoping to the target pond also
	// stops a fish sample from attaching to a log in another of the owner's
	// ponds.
	if (type === "fish_samples") {
		const referencedIds = [...new Set(data.map((row) => String(row.biomassLogId)))];
		const ownedLogs = await prisma.biomassLog.findMany({
			where: { id: { in: referencedIds }, pond: { id: pond.id, ownerId } },
			select: { id: true },
		});
		const ownedIds = new Set(ownedLogs.map((log) => log.id));
		if (referencedIds.some((id) => !ownedIds.has(id))) {
			throw badRequest("One or more biomassLogId values are not owned by this farm.");
		}
	}

	const transactionTimeoutMs = options.transactionTimeoutMs ?? IMPORT_TRANSACTION_TIMEOUT_MS;
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
					const rows = data.map((row, index) => {
						const deviceId = trimmedField(row, "deviceId") || defaultDeviceId;
						if (!deviceId) throw new Error("No device found");
						return {
							deviceId,
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
						};
					});
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
					const rows = data.map((row, index) => {
						const deviceId = trimmedField(row, "deviceId") || defaultDeviceId;
						if (!deviceId) throw new Error("No device found");
						return {
							deviceId,
							levelPercent: numberField(row, "levelPercent", index, { min: 0 }),
							distanceCm: numberField(row, "distanceCm", index, { min: 0 }),
							recordedAt: optionalDateField(row, "recordedAt", index) ?? new Date(),
						};
					});
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
			}

			// deviceId is a required FK (not nullable, no default) — skip the
			// audit event when the pond has no device rather than writing ""
			// and failing the whole transaction after the bulk insert. Every
			// provenance field is server-generated: an import cannot forge an
			// actor, a source or a backdated security event (#744).
			if (defaultDeviceId) {
				await tx.deviceStateEvent.create({
					data: {
						deviceId: defaultDeviceId,
						eventType: "data_imported",
						source: "user",
						actorId: ownerId,
						metadata: { type, count, pondId: pond.id },
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
		{ timeout: transactionTimeoutMs },
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
