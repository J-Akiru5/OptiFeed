import { pathToFileURL } from "node:url";

/**
 * Shared safety rules for the e2e fixture scripts and the Playwright setup.
 *
 * The suite runs against either the PRODUCTION Supabase project (decision D5,
 * amended — the integrator's remote fixture) or the disposable local stack.
 * These guards are the last line of defence:
 *
 * - a **remote** target needs BOTH E2E_ALLOWED_DB_HOST (exact host match) and
 *   E2E_CONFIRM_PRODUCTION="yes", so a stray dev URL cannot silently point the
 *   suite at another database and an accidental `pnpm test:e2e` still refuses;
 * - the exception is the disposable **local** stack (CI and local development):
 *   E2E_ALLOW_LOCAL_STACK="yes" permits a loopback DATABASE_URL host only. It
 *   never relaxes the remote path — a non-loopback host still needs the
 *   allow-list and the production acknowledgement above;
 * - every row the suite owns is named with the reserved "e2e-" prefix (or uses
 *   one of the reserved fake MACs).
 *
 * Nothing here deletes anything; the cleanup script validates every collected
 * identifier against these rules before it issues a single delete.
 */

export const E2E_PREFIX = "e2e-";
export const E2E_CONFIRM_VALUE = "yes";
/** Opt-in for the disposable local Supabase stack (`supabase start`). */
export const E2E_LOCAL_STACK_VALUE = "yes";
/** The value GitHub Actions exports for `CI`; any other value means "not CI". */
export const E2E_CI_VALUE = "true";

/**
 * Hostnames a disposable local stack may bind to. Matched exactly after
 * lower-casing, so `127.0.0.1.example.com` and `localhost.evil` are remote.
 */
export const E2E_LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as const;

export type E2eTargetMode = "local" | "remote";

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
	mode: E2eTargetMode;
};

function envValue(env: Record<string, string | undefined>, key: string): string {
	const value = env[key];
	return typeof value === "string" ? value.trim() : "";
}

/** True only for an exact loopback hostname (never a prefix match). */
export function isLocalE2eHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	return E2E_LOCAL_HOSTS.some((local) => local === normalized);
}

/**
 * Refuse to continue unless the database target is explicitly acknowledged.
 *
 * Two accepted shapes:
 *
 * 1. **local** — E2E_ALLOW_LOCAL_STACK="yes" and a loopback DATABASE_URL host.
 *    This is the disposable `supabase start` stack used by CI and by local
 *    runs; no acknowledgement is needed because the target is throwaway.
 * 2. **remote** — DATABASE_URL host equals E2E_ALLOWED_DB_HOST and
 *    E2E_CONFIRM_PRODUCTION is the literal "yes". This is the production
 *    fixture path and its rules are unchanged.
 *
 * Enabling local-stack mode does not weaken the remote path: any non-loopback
 * host falls through to the full allow-list + acknowledgement checks.
 *
 * Returns the verified host and mode so the caller can print them without
 * echoing the connection string.
 */
export function assertE2eEnvironment(
	env: Record<string, string | undefined> = process.env,
): E2eDatabaseTarget {
	const databaseUrl = envValue(env, "DATABASE_URL");
	const allowedHost = envValue(env, "E2E_ALLOWED_DB_HOST");
	const localStack = envValue(env, "E2E_ALLOW_LOCAL_STACK") === E2E_LOCAL_STACK_VALUE;

	if (!databaseUrl) {
		throw new Error(
			"e2e blocked: DATABASE_URL is not set. Set DATABASE_URL and E2E_ALLOWED_DB_HOST first.",
		);
	}

	let host: string;
	try {
		host = new URL(databaseUrl).hostname;
	} catch {
		throw new Error("e2e blocked: DATABASE_URL is not a valid URL.");
	}

	if (localStack && isLocalE2eHost(host)) {
		return { host, mode: "local" };
	}

	if (!allowedHost) {
		throw new Error(
			localStack
				? `e2e blocked: E2E_ALLOW_LOCAL_STACK=yes only authorises a loopback DATABASE_URL host (${E2E_LOCAL_HOSTS.join(", ")}), but the host is "${host}". Set E2E_ALLOWED_DB_HOST to that exact host and E2E_CONFIRM_PRODUCTION="${E2E_CONFIRM_VALUE}" to run against a remote target.`
				: "e2e blocked: E2E_ALLOWED_DB_HOST is not set. Set it to the exact host of the e2e database.",
		);
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

	return { host, mode: "remote" };
}

/**
 * CI-only preflight for the disposable local Supabase stack (issue #317).
 *
 * The regular guard runs inside the seed and the Playwright global setup, which
 * is *after* `prisma migrate deploy` in the CI job. A misconfigured
 * DATABASE_URL therefore used to be able to apply migrations to a real project
 * before anything refused. This check runs before the migration step and is
 * deliberately stricter than local mode:
 *
 * - `CI` must be the literal "true" (GitHub Actions sets it), so the check
 *   cannot be used as a general-purpose relaxation;
 * - `E2E_ALLOW_LOCAL_STACK` must still be "yes";
 * - the DATABASE_URL host must be loopback. A remote host is refused even when
 *   `E2E_ALLOWED_DB_HOST` and `E2E_CONFIRM_PRODUCTION` are also set: CI never
 *   runs against a hosted project.
 *
 * Returns the verified host so the caller can print it without echoing the
 * connection string.
 */
export function assertCiLocalStackTarget(
	env: Record<string, string | undefined> = process.env,
): E2eDatabaseTarget {
	if (envValue(env, "CI") !== E2E_CI_VALUE) {
		throw new Error(
			`e2e ci blocked: CI must be "${E2E_CI_VALUE}". This preflight is only for the CI job; use the normal local or remote path elsewhere.`,
		);
	}

	if (envValue(env, "E2E_ALLOW_LOCAL_STACK") !== E2E_LOCAL_STACK_VALUE) {
		throw new Error(
			`e2e ci blocked: E2E_ALLOW_LOCAL_STACK must be "${E2E_LOCAL_STACK_VALUE}" for the CI e2e job.`,
		);
	}

	const databaseUrl = envValue(env, "DATABASE_URL");
	if (!databaseUrl) {
		throw new Error("e2e ci blocked: DATABASE_URL is not set.");
	}

	let host: string;
	try {
		host = new URL(databaseUrl).hostname;
	} catch {
		throw new Error("e2e ci blocked: DATABASE_URL is not a valid URL.");
	}

	if (!isLocalE2eHost(host)) {
		throw new Error(
			`e2e ci blocked: DATABASE_URL host "${host}" is not a loopback host (${E2E_LOCAL_HOSTS.join(
				", ",
			)}). CI only runs against the disposable local stack; refusing before any migration.`,
		);
	}

	return { host, mode: "local" };
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
