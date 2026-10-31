/**
 * Export limits and markers (issue #353).
 *
 * Kept free of Node-only imports because the download client reads the same
 * values to verify the file it just received.
 */

export const BACKUP_SQL_FORMAT_VERSION = 1;

/** Row cap. Counted before the response starts so the error is an HTTP status. */
export const BACKUP_EXPORT_MAX_ROWS = 250_000;

/** Byte cap, enforced while streaming. */
export const BACKUP_EXPORT_MAX_BYTES = 64 * 1024 * 1024;

/** Rows read per query. */
export const BACKUP_EXPORT_BATCH = 500;

/** Streaming budget, checked between batches. */
export const BACKUP_EXPORT_TIMEOUT_MS = 120_000;

/**
 * The start of the closing block. Every byte before the newline immediately
 * preceding this marker is the hashed payload, so the trailer can carry its own
 * checksum without a circular hash.
 */
export const BACKUP_TRAILER_MARKER = "-- === END OF EXPORT ===";

/** The step-up error code the download client looks for (lib/auth/step-up.ts). */
export const BACKUP_STEP_UP_REQUIRED_CODE = "step_up_required";
