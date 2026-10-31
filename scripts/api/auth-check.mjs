/**
 * Static API route authorization check (issue #332).
 *
 * The old CI step (and the test sweep it was modelled on) only proved that a
 * route file *imports* a guard helper. A file that imports `withAuth` and then
 * exports an unwrapped handler passed, so the invariant CI claimed to enforce
 * was not the invariant it checked.
 *
 * This check reads each `app/api/**\/route.ts` and asserts the guard is in the
 * exported handler's call path:
 *
 *  - session routes: the exported method is `withApi(withAuth(handler))` (or
 *    `withAuth(handler)`), and `withAuth` is imported from the auth module;
 *  - cron routes: `withApi(withCronAuth(handler))`;
 *  - platform-admin routes: the handler itself calls `getVerifiedSession()` and
 *    `isCurrentPlatformAdmin()`;
 *  - device-token routes: the handler itself calls `verifyDeviceToken(...)`.
 *
 * The public allow-list is explicit and carries a reason. Anything not listed
 * and not guarded is a failure. Run through `pnpm api:check`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "apps", "web", "app", "api");

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Routes allowed to skip a session/device guard, each with the reason it is
 * safe. An entry here is a policy decision, not a suppression: adding one is a
 * reviewable change to this list.
 */
export const PUBLIC_ROUTES = new Map([
	[
		"health/route.ts",
		{
			kind: "public",
			reason: "liveness probe; returns only whether the database is reachable",
		},
	],
	[
		"[...fallback]/route.ts",
		{
			kind: "re-export",
			reason: "single 404 handler owned by the error envelope; no tenant data",
		},
	],
]);

/** Device-token routes: the firmware authenticates with a provisioning token. */
export const DEVICE_TOKEN_ROUTES = new Map([
	["ingest/route.ts", "device heartbeat/telemetry ingest"],
	["feed-command/route.ts", "firmware command poll"],
	["schedule-sync/route.ts", "firmware schedule sync"],
	["firmware/check/route.ts", "firmware OTA check"],
]);

/** Platform-admin routes (no tenant binding, so `withAuth` cannot resolve one). */
export const PLATFORM_ADMIN_ROUTES = new Map([
	["platform/audit/export/route.ts", "platform audit CSV"],
]);

const SESSION_IMPORT = "@/lib/auth/with-auth";
const DEVICE_IMPORT = "@/lib/device-auth";
const PLATFORM_SESSION_IMPORTS = ["@/lib/auth/verify-session", "@/lib/auth/session"];
const PLATFORM_ADMIN_IMPORT = "@/lib/auth/require-platform-admin";

function posix(path) {
	return path.split(sep).join("/");
}

function walk(dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (entry === "route.ts" || entry === "route.tsx") out.push(full);
	}
	return out;
}

/** Strip comments while keeping strings intact, for structural regexes. */
function stripComments(source) {
	let out = "";
	let quote = null;
	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		const next = source[i + 1];
		if (quote) {
			out += char;
			if (char === "\\") {
				out += next ?? "";
				i += 1;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i += 1;
			out += "\n";
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
			i += 1;
			continue;
		}
		out += char;
	}
	return out;
}

/**
 * Read from `openIndex` (an opening bracket) to its matching close, skipping
 * strings and comments so a `)` inside a template literal cannot end the scan.
 */
export function readBalanced(source, openIndex) {
	const pairs = { "(": ")", "{": "}", "[": "]" };
	const close = pairs[source[openIndex]];
	if (!close) return source.slice(openIndex);
	const stack = [close];
	let quote = null;
	for (let i = openIndex + 1; i < source.length; i += 1) {
		const char = source[i];
		const next = source[i + 1];
		if (quote) {
			if (char === "\\") i += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") stack.push(")");
		else if (char === "{") stack.push("}");
		else if (char === "[") stack.push("]");
		else if (char === stack[stack.length - 1]) {
			stack.pop();
			if (stack.length === 0) return source.slice(openIndex, i + 1);
		}
	}
	return source.slice(openIndex);
}

/** The text of every exported HTTP method handler (const or function form). */
export function exportedHandlers(source) {
	const clean = stripComments(source);
	const handlers = new Map();

	for (const method of METHODS) {
		const constMatch = new RegExp(`export\\s+const\\s+${method}\\s*=`).exec(clean);
		if (constMatch) {
			const start = constMatch.index + constMatch[0].length;
			handlers.set(method, readExpression(clean, start));
			continue;
		}
		const functionMatch = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`).exec(
			clean,
		);
		if (functionMatch) {
			const paramsOpen = functionMatch.index + functionMatch[0].length - 1;
			const params = readBalanced(clean, paramsOpen);
			const bodyStart = clean.indexOf("{", paramsOpen + params.length);
			handlers.set(method, bodyStart === -1 ? "" : readBalanced(clean, bodyStart));
		}
	}

	return handlers;
}

/** From just after `=`, read to the top-level `;` (or the end of the file). */
function readExpression(source, start) {
	const stack = [];
	let quote = null;
	for (let i = start; i < source.length; i += 1) {
		const char = source[i];
		const next = source[i + 1];
		if (quote) {
			if (char === "\\") i += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") stack.push(")");
		else if (char === "{") stack.push("}");
		else if (char === "[") stack.push("]");
		else if (char === stack[stack.length - 1]) stack.pop();
		else if (char === ";" && stack.length === 0) return source.slice(start, i);
	}
	return source.slice(start);
}

function importsFrom(source, name, modules) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	for (const module of modules) {
		const escapedModule = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(
			`import\\s+[^;]*\\b${escaped}\\b[^;]*from\\s+["']${escapedModule}["']`,
		);
		if (pattern.test(source)) return true;
	}
	return false;
}

/** `withApi(withAuth(` / `withAuth(` at the very start of the handler expression. */
function wrappedBy(expression, guard) {
	const normalized = expression.replace(/\s+/g, " ").trim();
	return (
		new RegExp(`^withApi\\( ?${guard}\\(`).test(normalized) ||
		new RegExp(`^${guard}\\(`).test(normalized)
	);
}

/** A real call in the handler expression, not a mention or an import. */
function callsInHandler(expression, name) {
	return new RegExp(`\\b${name}\\s*\\(`).test(expression);
}

/**
 * Analyse one route file. Returns `{ path, failures, notes }`; failures are
 * human-readable lines the CLI prints and the test asserts on.
 */
export function analyzeRoute(path, source) {
	const failures = [];
	const notes = [];
	const handlers = exportedHandlers(source);
	const declared = handlers.size > 0;
	const publicEntry = PUBLIC_ROUTES.get(path);

	if (!declared) {
		// `export { handler as GET, ... }` is the documented re-export hub.
		const reExports = /export\s*\{[^}]*\bas\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(
			stripComments(source),
		);
		if (publicEntry?.kind === "re-export" && reExports) return { path, failures, notes };
		failures.push("no exported HTTP handler (GET/POST/...) found");
		return { path, failures, notes };
	}

	if (publicEntry) {
		notes.push(`${publicEntry.kind}: ${publicEntry.reason}`);
		if (publicEntry.kind === "public") {
			for (const [method, expression] of handlers) {
				if (/withAuth\s*\(|withCronAuth\s*\(|verifyDeviceToken\s*\(/.test(expression)) {
					failures.push(`${method}: public route must not use a session/device guard`);
				}
			}
		}
		return { path, failures, notes };
	}

	const deviceReason = DEVICE_TOKEN_ROUTES.get(path);
	const platformReason = PLATFORM_ADMIN_ROUTES.get(path);
	const cron = /cron[\\/]/.test(path);

	for (const [method, expression] of handlers) {
		if (deviceReason) {
			if (!callsInHandler(expression, "verifyDeviceToken")) {
				failures.push(`${method}: handler does not call verifyDeviceToken()`);
			}
			if (!importsFrom(source, "verifyDeviceToken", [DEVICE_IMPORT])) {
				failures.push(`${method}: verifyDeviceToken is not imported from ${DEVICE_IMPORT}`);
			}
			continue;
		}

		if (platformReason) {
			if (!callsInHandler(expression, "getVerifiedSession")) {
				failures.push(`${method}: handler does not call getVerifiedSession()`);
			}
			if (!callsInHandler(expression, "isCurrentPlatformAdmin")) {
				failures.push(`${method}: handler does not call isCurrentPlatformAdmin()`);
			}
			if (!importsFrom(source, "getVerifiedSession", PLATFORM_SESSION_IMPORTS)) {
				failures.push(`${method}: getVerifiedSession is not imported from a session module`);
			}
			if (!importsFrom(source, "isCurrentPlatformAdmin", [PLATFORM_ADMIN_IMPORT])) {
				failures.push(
					`${method}: isCurrentPlatformAdmin is not imported from ${PLATFORM_ADMIN_IMPORT}`,
				);
			}
			continue;
		}

		const guard = cron ? "withCronAuth" : "withAuth";
		if (!wrappedBy(expression, guard)) {
			failures.push(`${method}: handler is not wrapped in ${guard}()`);
		}
		if (!importsFrom(source, guard, [SESSION_IMPORT])) {
			failures.push(`${method}: ${guard} is not imported from ${SESSION_IMPORT}`);
		}
	}

	notes.push(
		deviceReason
			? `device token: ${deviceReason}`
			: platformReason
				? `platform admin: ${platformReason}`
				: cron
					? "cron secret"
					: "session",
	);
	return { path, failures, notes };
}

function summarize(routes) {
	let checks = 0;
	const failures = [];
	for (const route of routes) {
		checks += 1;
		if (route.failures.length === 0) {
			console.log(
				`PASS  ${route.path}${route.notes.length > 0 ? ` (${route.notes.join("; ")})` : ""}`,
			);
		} else {
			for (const failure of route.failures) {
				failures.push({ path: route.path, failure });
				console.log(`FAIL  ${route.path}: ${failure}`);
			}
		}
	}
	return { checks, failures };
}

function main() {
	const files = walk(API_DIR);
	if (files.length === 0) {
		console.error("FAIL  no route files found under apps/web/app/api");
		process.exitCode = 1;
		return;
	}

	const routes = files.map((file) => {
		const path = posix(relative(API_DIR, file));
		return analyzeRoute(path, readFileSync(file, "utf8"));
	});
	const { checks, failures } = summarize(routes);

	console.log(`\nAPI route auth: ${checks} route file(s), ${failures.length} failure(s)`);
	if (failures.length > 0) {
		console.log(
			"\nEvery non-public route must call its guard inside the exported handler. " +
				"Add a reason to PUBLIC_ROUTES, DEVICE_TOKEN_ROUTES or PLATFORM_ADMIN_ROUTES only when the route is deliberately covered another way.",
		);
		process.exitCode = 1;
	}
}

// Only run when executed directly, so the vitest suite can import the rules.
if (process.argv[1] && posix(process.argv[1]).endsWith("scripts/api/auth-check.mjs")) {
	main();
}
