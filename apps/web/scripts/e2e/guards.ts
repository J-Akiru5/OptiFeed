import { pathToFileURL } from "node:url";

/**
 * Shared safety rules for the e2e fixture scripts and the Playwright setup.
 *
 * The suite runs against the PRODUCTION Supabase project (decision D5,
 * amended). These guards are the last line of defence:
 *
 * - the DATABASE_URL host must equal E2E_ALLOWED_DB_HOST, so a stray dev URL
 *   cannot silently point the suite at another database;
 * - E2E_CONFIRM_PRODUCTION must be the literal string "yes", so an accidental
 *   `pnpm test:e2e` without the explicit acknowledgement still refuses;
 * - every row the suite owns is named with the reserved "e2e-" prefix (or uses
 *   one of the reserved fake MACs).
 *
 * Nothing here deletes anything; the cleanup script validates every collected
 * identifier against these rules before it issues a single delete.
 */

export const E2E_PREFIX = "e2e-";
export const E2E_CONFIRM_VALUE = "yes";

export const E2E_LOGIN_IDS = {
	farmer: "e2e-farmer",
	admin: "e2e-admin",
	platform: "e2e-platform-admin",
} as const;

export type E2eLoginRole = keyof typeof E2E_LOGIN_IDS;

export const E2E_ORG = {
	id: "e2e-org",
	name: "e2e-org",
	type: "INDIVIDUAL",
	status: "ACTIVE",
} as const;

export const E2E_POND = {
	id: "e2e-pond",
	name: "e2e-pond",
} as const;

/**
 * Fake units the suite may create. The first is seeded, the second is
 * registered by the superadmin spec. They are never real feeders.
 */
export const E2E_DEVICE_MACS = ["E2:E0:00:00:00:01", "E2:E0:00:00:00:02"] as const;

export const E2E_DEVICE_LABEL = "e2e-feeder";
export const E2E_REGISTERED_DEVICE_LABEL = "e2e-feeder-2";

/** The temporary platform-admin grant cannot outlive a forgotten run. */
export const E2E_PLATFORM_GRANT_HOURS = 2;

export type E2eDatabaseTarget = {
	host: string;
};

function envValue(env: Record<string, string | undefined>, key: string): string {
	const value = env[key];
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Refuse to continue unless the database target is explicitly acknowledged.
 * Returns the verified host so the caller can print it without echoing the
 * connection string.
 */
export function assertE2eEnvironment(
	env: Record<string, string | undefined> = process.env,
): E2eDatabaseTarget {
	const databaseUrl = envValue(env, "DATABASE_URL");
	const allowedHost = envValue(env, "E2E_ALLOWED_DB_HOST");

	if (!databaseUrl) {
		throw new Error(
			"e2e blocked: DATABASE_URL is not set. Set DATABASE_URL and E2E_ALLOWED_DB_HOST first.",
		);
	}
	if (!allowedHost) {
		throw new Error(
			"e2e blocked: E2E_ALLOWED_DB_HOST is not set. Set it to the exact host of the e2e database.",
		);
	}

	let host: string;
	try {
		host = new URL(databaseUrl).hostname;
	} catch {
		throw new Error("e2e blocked: DATABASE_URL is not a valid URL.");
	}

	if (host !== allowedHost) {
		throw new Error(
			`e2e blocked: DATABASE_URL host "${host}" is not the allow-listed host "${allowedHost}".`,
		);
	}

	if (envValue(env, "E2E_CONFIRM_PRODUCTION") !== E2E_CONFIRM_VALUE) {
		throw new Error(
			`e2e blocked: E2E_CONFIRM_PRODUCTION must be "${E2E_CONFIRM_VALUE}". The suite is only authorised against the acknowledged e2e target.`,
		);
	}

	return { host };
}

/** The one password shared by the three e2e logins. Required, never logged. */
export function requireE2ePassword(env: Record<string, string | undefined> = process.env): string {
	const password = env.E2E_PASSWORD;
	if (typeof password !== "string" || password.length === 0) {
		throw new Error(
			"E2E_PASSWORD is not set. Set it to the password for the e2e- accounts (seed and Playwright both read it).",
		);
	}
	return password;
}

/** True only for the reserved test-data prefix. */
export function isE2eIdentifier(value: string | null | undefined): boolean {
	if (typeof value !== "string") return false;
	return value.trim().toLowerCase().startsWith(E2E_PREFIX);
}

/** True for a pond login address whose local part carries the e2e prefix. */
export function isE2eEmail(value: string | null | undefined): boolean {
	if (typeof value !== "string") return false;
	const normalized = value.trim().toLowerCase();
	const suffix = "@pond.optifeed.local";
	if (!normalized.endsWith(suffix)) return false;
	return isE2eIdentifier(normalized.slice(0, -suffix.length));
}

/** True only for the two reserved fake MACs, ignoring case and separators. */
export function isE2eMac(value: string | null | undefined): boolean {
	if (typeof value !== "string") return false;
	const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
	return E2E_DEVICE_MACS.some((mac) => mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase() === hex);
}

/**
 * Throw instead of deleting a row that is not test data. Used for identifiers
 * that have no prefix of their own (device rows) and for auth accounts.
 */
export function assertE2eIdentifier(
	value: string | null | undefined,
	label = "identifier",
): string {
	if (!isE2eIdentifier(value)) {
		throw new Error(
			`Refusing to touch ${label} "${value ?? ""}": e2e cleanup only deletes identifiers starting with "${E2E_PREFIX}".`,
		);
	}
	return (value as string).trim();
}

/** Run `main()` only when the file is the process entry point (not under vitest). */
export function isMainModule(
	metaUrl: string,
	argvPath: string | undefined = process.argv[1],
): boolean {
	if (!argvPath) return false;
	try {
		return pathToFileURL(argvPath).href === metaUrl;
	} catch {
		return false;
	}
}
