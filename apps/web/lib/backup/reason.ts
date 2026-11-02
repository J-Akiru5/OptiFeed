/**
 * The `reason` every backup export records (#671).
 *
 * The reason is written into the dump's `--` header, so a newline (or any other
 * control character) would end the comment and let the rest of the value run as
 * SQL when the file is restored. Validation therefore rejects control
 * characters instead of trimming them, and the SQL generator neutralises them
 * as a second line of defence.
 */

export const MIN_BACKUP_REASON_LENGTH = 10;
export const MAX_BACKUP_REASON_LENGTH = 500;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** True when the value contains a character that can break a `--` comment. */
export function hasControlCharacters(value: string): boolean {
	return CONTROL_CHARACTERS.test(value);
}

export type OptionalBackupReason = { ok: true; value: string | null } | { ok: false };

/**
 * Tenant export: the reason is optional; blank means "use the route's default".
 * A non-string, an over-long value or one with control characters is invalid.
 */
export function readOptionalBackupReason(value: unknown): OptionalBackupReason {
	if (value === undefined || value === null) return { ok: true, value: null };
	if (typeof value !== "string") return { ok: false };
	const trimmed = value.trim();
	if (trimmed.length > MAX_BACKUP_REASON_LENGTH) return { ok: false };
	if (hasControlCharacters(trimmed)) return { ok: false };
	return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

/**
 * Platform export: the reason is mandatory, 10–500 characters, single line.
 * Returns the trimmed reason or null when it is invalid.
 */
export function readRequiredBackupReason(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length < MIN_BACKUP_REASON_LENGTH || trimmed.length > MAX_BACKUP_REASON_LENGTH) {
		return null;
	}
	if (hasControlCharacters(trimmed)) return null;
	return trimmed;
}
