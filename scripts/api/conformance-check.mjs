#!/usr/bin/env node
/**
 * Static API-regulation conformance check.
 *
 * Runs in CI without a server or database, so the rules that can be checked
 * from source are enforced on every pull request instead of being suggestions.
 * The live §11 suites cover envelopes, headers, and latency at runtime.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const WEB = join(ROOT, "apps", "web");
const API_DIR = join(WEB, "app", "api");
const ENDPOINTS_FILE = join(ROOT, "scripts", "api", "endpoints.json");
const NEXT_CONFIG = join(WEB, "next.config.ts");

// The catch-all is a re-export hub, not a handler written with withApi inline.
const RE_EXPORT_ROUTES = new Set(["[...fallback]/route.ts"]);

// findMany calls that are bounded by another declared limit.
const UNBOUNDED_ALLOW = new Map([
	[
		"import/confirm/route.ts",
		"bounded by IMPORT_ROW_LIMIT (the parse rejects more rows before this query)",
	],
]);

const failures = [];
let checks = 0;
const files = [];

function pass(message) {
	checks += 1;
	console.log(`PASS  ${message}`);
}

function fail(message, detail) {
	checks += 1;
	failures.push({ message, detail });
	console.log(`FAIL  ${message}${detail ? ` — ${detail}` : ""}`);
}

function walk(dir) {
	if (!existsSync(dir)) return [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full);
		else if (entry === "route.ts" || entry === "route.tsx") files.push(full);
	}
	return files;
}

function posix(path) {
	return path.split(sep).join("/");
}

function routePathOf(file) {
	const rel = posix(relative(API_DIR, file)).replace(/\/(route\.tsx?)$/, "");
	return `/api${rel === "" ? "" : `/${rel}`}`;
}

function unwrapCalls(source, marker) {
	const calls = [];
	let index = source.indexOf(marker);
	while (index !== -1) {
		calls.push(readBalanced(source, index + marker.length - 1));
		index = source.indexOf(marker, index + marker.length);
	}
	return calls;
}

/** Read from an opening `(` to its matching `)`, skipping strings. */
function readBalanced(source, openIndex) {
	let depth = 0;
	let quote = null;
	for (let i = openIndex; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			if (char === "\\") i += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth += 1;
		else if (char === ")") {
			depth -= 1;
			if (depth === 0) return source.slice(openIndex, i + 1);
		}
	}
	return source.slice(openIndex);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

console.log("API regulation conformance (static)\n");

walk(API_DIR);
if (files.length === 0) fail("route tree found", "no app/api/**/route.ts files");

for (const file of files) {
	const rel = posix(relative(API_DIR, file));
	const source = readFileSync(file, "utf8");

	if (!RE_EXPORT_ROUTES.has(rel)) {
		const importsInstrumentation = /from\s+["']@\/lib\/api\/instrumentation["']/.test(source);
		const handlerExports = [
			...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g),
		];

		if (!importsInstrumentation || handlerExports.length === 0) {
			fail(`${rel}: handler is instrumented`, "missing withApi import or handler export");
		} else {
			const unwrapped = handlerExports.filter((match) => {
				const after = source.slice(match.index, match.index + 300);
				return !after.includes("withApi(");
			});
			if (unwrapped.length > 0) {
				fail(`${rel}: every handler is wrapped in withApi`, unwrapped.map((m) => m[1]).join(", "));
			} else {
				pass(`${rel}: every handler is wrapped in withApi`);
			}
		}
	}

	if (!UNBOUNDED_ALLOW.has(rel)) {
		const unbounded = unwrapCalls(source, ".findMany(").filter((call) => !/\btake\s*:/.test(call));
		if (unbounded.length > 0) {
			fail(`${rel}: list queries are bounded`, `${unbounded.length} findMany() without take`);
		} else {
			pass(`${rel}: list queries are bounded`);
		}
	}

	if (/select\s+\*/i.test(source)) {
		fail(`${rel}: no SELECT *`, "explicit column list required on the hot path");
	}
}

const nextConfig = readFileSync(NEXT_CONFIG, "utf8");
if (/source:\s*["']\/api\/v1\/:path\*["']/.test(nextConfig)) {
	pass("next.config.ts serves the versioned /api/v1 tree");
} else {
	fail("next.config.ts serves the versioned /api/v1 tree", "rewrite missing");
}

const config = readJson(ENDPOINTS_FILE);
const declared = new Set();
for (const endpoint of [...config.endpoints, ...config.excluded]) {
	const path = endpoint.path.split("?")[0].replace(/^\/api\/v1/, "/api");
	declared.add(path);
	if (path === "/api/v1/{fallback}" || path.includes("{fallback}")) continue;
	const file = join(API_DIR, `${path.replace(/^\/api\/?/, "")}`, "route.ts");
	const normalized = join(API_DIR, path.replace(/^\/api\/?/, ""), "route.ts");
	if (!existsSync(file) && !existsSync(normalized)) {
		fail(`endpoints.json: ${endpoint.path} resolves to a route file`);
	}
}
pass(`endpoints.json declares ${config.endpoints.length} measured endpoint(s)`);

for (const file of files) {
	const rel = posix(relative(API_DIR, file));
	if (RE_EXPORT_ROUTES.has(rel)) continue;
	const routePath = routePathOf(file);
	if (!declared.has(routePath)) {
		fail(`${rel}: declared in scripts/api/endpoints.json`, `missing entry for ${routePath}`);
	}
}

const enabled = config.endpoints.filter((endpoint) => endpoint.contract || endpoint.latency);
if (enabled.length === 0)
	fail("coverage denominator is non-empty", "no measured endpoints declared");

console.log(
	`\nSummary: ${files.length} route file(s), ${checks} check(s), ${failures.length} failure(s)`,
);
if (failures.length > 0) {
	console.log(
		"\nFix the failures above or add a justified exemption to scripts/api/endpoints.json.",
	);
	process.exit(1);
}
console.log("Static conformance passed.");
