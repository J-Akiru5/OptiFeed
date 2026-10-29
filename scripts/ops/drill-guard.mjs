/**
 * Shared safety rules for the restore-drill scripts (ISO/IEC 25010 reliability, W12).
 *
 * The drill destroys the `public` schema of the database it runs against, so the
 * scripts must never accept an arbitrary `DATABASE_URL` by accident:
 *
 * - a loopback host (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) is always
 *   accepted — that is the throwaway Postgres the workflow starts;
 * - any other host is refused unless the operator sets BOTH
 *   `RESTORE_DRILL_ALLOW_NONLOCAL=yes` and `RESTORE_DRILL_ALLOWED_DB_HOST` to
 *   the exact hostname being targeted.
 *
 * The two-variable rule mirrors `apps/web/scripts/e2e/guards.ts`: a single
 * acknowledgement flag can leak into a shell and silently point at the wrong
 * database, while an exact hostname cannot be satisfied by accident.
 *
 * The environment is never printed: only `host:port/database`.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root (`scripts/ops` -> repository root). */
export const REPO_ROOT = join(HERE, "..", "..");
/** The Next.js app that owns the Prisma schema and client. */
export const WEB_DIR = join(REPO_ROOT, "apps", "web");

/** Every row this drill owns starts with this prefix (see drill-fixture.mjs). */
export const DRILL_PREFIX = "drill-";
/** The only accepted value of RESTORE_DRILL_ALLOW_NONLOCAL. */
export const NONLOCAL_ACK_VALUE = "yes";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

function envValue(env, key) {
	const value = env[key];
	return typeof value === "string" ? value.trim() : "";
}

/** `[::1]` -> `::1`, `LocalHost` -> `localhost`. */
export function normalizeHost(hostname) {
	return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Parse DATABASE_URL without ever returning the credentials.
 * Returns the target description the scripts print (host, port, database).
 */
export function readDatabaseTarget(env = process.env) {
	const url = envValue(env, "DATABASE_URL");
	if (!url) {
		throw new Error(
			"restore drill blocked: DATABASE_URL is not set. Point it at a scratch Postgres 16 database.",
		);
	}

	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("restore drill blocked: DATABASE_URL is not a valid URL.");
	}

	if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
		throw new Error(
			`restore drill blocked: DATABASE_URL must be a postgres:// URL (got "${parsed.protocol}").`,
		);
	}

	const host = normalizeHost(parsed.hostname);
	const port = parsed.port || "5432";
	const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)";

	return {
		host,
		port,
		database,
		local: LOCAL_HOSTNAMES.has(host),
	};
}

/** `localhost:5432/drill` — never contains a user or password. */
export function describeTarget(target) {
	return `${target.host}:${target.port}/${target.database}`;
}

/**
 * Refuse to continue unless the target is a loopback database or the operator
 * explicitly acknowledged this exact non-local host. Returns the safe target
 * description.
 */
export function assertDrillTarget(env = process.env) {
	const target = readDatabaseTarget(env);
	if (target.local) {
		return target;
	}

	const acknowledgement = envValue(env, "RESTORE_DRILL_ALLOW_NONLOCAL");
	const allowedHost = normalizeHost(envValue(env, "RESTORE_DRILL_ALLOWED_DB_HOST"));

	if (acknowledgement === NONLOCAL_ACK_VALUE && allowedHost && allowedHost === target.host) {
		return target;
	}

	throw new Error(
		[
			`restore drill blocked: DATABASE_URL host "${target.host}" is not a loopback database.`,
			"The drill DROPS and recreates the public schema of the target database.",
			"To run it against a non-local scratch database, set both:",
			`  RESTORE_DRILL_ALLOW_NONLOCAL=${NONLOCAL_ACK_VALUE}`,
			`  RESTORE_DRILL_ALLOWED_DB_HOST=${target.host}`,
			"Never point this at production, staging, or a real Supabase project.",
		].join("\n"),
	);
}

/**
 * Resolve `@prisma/client` from `apps/web` so the scripts can live at the
 * repository root without adding a dependency to it. pnpm only links a
 * package's declared dependencies, and Prisma is declared by the web app.
 */
export function loadPrismaClient() {
	const requireFromWeb = createRequire(join(WEB_DIR, "package.json"));
	let mod;
	try {
		mod = requireFromWeb("@prisma/client");
	} catch (error) {
		throw new Error(
			[
				"restore drill blocked: could not load @prisma/client from apps/web.",
				"Run `pnpm install && pnpm --filter web prisma:generate` first.",
				`(${error instanceof Error ? error.message : String(error)})`,
			].join(" "),
		);
	}
	if (typeof mod?.PrismaClient !== "function") {
		throw new Error("restore drill blocked: @prisma/client did not export PrismaClient.");
	}
	return mod.PrismaClient;
}

/** True only for the reserved drill fixture prefix. */
export function isDrillIdentifier(value) {
	return typeof value === "string" && value.startsWith(DRILL_PREFIX);
}
