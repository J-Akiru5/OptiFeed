/**
 * Secret scrubbing for first-party error capture (mission 2026-10-29e, I-64).
 *
 * `reportError()` may be handed anything: a Supabase/Postgres error that
 * echoes a connection string, a fetch failure that quotes an `Authorization`
 * header, a device ingest error that carries `X-Device-Token`, or a validation
 * message with an e-mail address. None of that may reach `ErrorEvent`.
 *
 * The scrubber is deliberately allow-by-default for shapes and deny-by-pattern
 * for secrets: known secret spellings (headers, bearer tokens, key/value pairs,
 * JWTs, Supabase keys, e-mails) are replaced, then any remaining long
 * high-entropy run is replaced as a defensive last pass. Everything here is
 * pure and synchronous so it can be unit-tested without a database.
 */

export type ErrorSeverity = "ERROR" | "WARNING" | "INFO";

export const REDACTED = "[redacted]";
export const REDACTED_EMAIL = "[redacted-email]";
export const REDACTED_TOKEN = "[redacted-token]";
export const REDACTED_KEY = "[redacted-key]";

/** Longest text passed to the regex passes; longer input is truncated first. */
const MAX_INPUT_LENGTH = 100_000;
const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 50;

/**
 * Header-style credentials. `Authorization` may carry a scheme, so an optional
 * `bearer` prefix is consumed along with the value.
 */
const HEADER_PATTERN =
	/\b(x-device-token|authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi;

const BEARER_PATTERN = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * `password=…`, `"password": "…"`, `token: '…'` and friends. Also redacts a
 * plain `email=` value; raw addresses elsewhere are caught below.
 */
const KEY_VALUE_PATTERN =
	/\b(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|device[_-]?token|api[_-]?key|authorization|cookie|service[_-]?role[_-]?key|anon[_-]?key|supabase[_-]?key|email)(\s*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;

/** Legacy Supabase keys and session access tokens are JWTs. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;

/** New Supabase secret/publishable keys and personal access tokens. */
const SUPABASE_KEY_PATTERN = /\bsb(?:p)?_(?:secret|publishable)?_?[A-Za-z0-9_-]{16,}\b/g;

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Defensive last pass: 32+ hex characters (device tokens, hashes) and 40+
 * base64url characters (opaque tokens) are credentials far more often than
 * they are prose. Stack traces and file paths do not match either shape.
 */
const LONG_HEX_PATTERN = /\b[a-f0-9]{32,}\b/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Field names whose values are credentials or identifiers we never persist.
 * `email` is included because an address is personal data, not diagnostics.
 */
const SENSITIVE_KEY_PATTERN =
	/(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session|email|service[_-]?role|anon[_-]?key|supabase[_-]?key)/i;

/** True when a context key names a value that must not be stored. */
export function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_PATTERN.test(key);
}

/** Replace every recognised secret in one string. */
export function scrubText(value: string): string {
	const input = value.length > MAX_INPUT_LENGTH ? value.slice(0, MAX_INPUT_LENGTH) : value;

	const scrubbed = input
		.replace(HEADER_PATTERN, (_match, name: string, separator: string) => {
			return `${name}${separator}${REDACTED}`;
		})
		.replace(BEARER_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
		.replace(KEY_VALUE_PATTERN, (_match, key: string, separator: string) => {
			return `${key}${separator}${REDACTED}`;
		})
		.replace(JWT_PATTERN, REDACTED_KEY)
		.replace(SUPABASE_KEY_PATTERN, REDACTED_KEY)
		.replace(EMAIL_PATTERN, REDACTED_EMAIL)
		.replace(LONG_HEX_PATTERN, REDACTED_TOKEN)
		.replace(LONG_TOKEN_PATTERN, REDACTED_TOKEN);

	return scrubbed;
}

/**
 * Scrub one arbitrary value recursively.
 *
 * Objects are capped by depth and entry count so a pathological context cannot
 * bloat the row, and a sensitive key redacts its whole value (including nested
 * objects) rather than trying to partially clean it.
 */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (typeof value === "string") {
		return scrubText(value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value);
	}
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
		return REDACTED;
	}
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		return {
			name: value.name,
			message: scrubText(value.message),
			stack: value.stack ? scrubText(value.stack) : null,
		};
	}
	if (depth >= MAX_DEPTH) return REDACTED;
	if (typeof value === "object") {
		if (seen.has(value)) return "[circular]";
		seen.add(value);

		if (Array.isArray(value)) {
			return value.slice(0, MAX_ENTRIES).map((entry) => scrubValue(entry, depth + 1, seen));
		}

		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
			out[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entry, depth + 1, seen);
		}
		return out;
	}

	return String(value);
}

/** Scrub a request/error context object, or `null` when there is none. */
export function scrubContext(context?: Record<string, unknown>): Record<string, unknown> | null {
	if (!context) return null;
	const scrubbed = scrubValue(context);
	if (typeof scrubbed !== "object" || scrubbed === null || Array.isArray(scrubbed)) return null;
	return scrubbed as Record<string, unknown>;
}

/** Message and stack for any thrown value, before scrubbing. */
export function errorDetails(error: unknown): { message: string; stack: string | null } {
	if (error instanceof Error) {
		return {
			message: error.message.trim() || error.name || "Unknown error",
			stack: error.stack ?? null,
		};
	}
	if (typeof error === "string") {
		return { message: error.trim() || "Unknown error", stack: null };
	}
	try {
		const serialised = JSON.stringify(error);
		return { message: serialised && serialised !== "{}" ? serialised : String(error), stack: null };
	} catch {
		return { message: String(error), stack: null };
	}
}
