#!/usr/bin/env node
/**
 * First-load JS budget gate for the Next.js app.
 *
 * `next build` (Turbopack, Next 16) no longer prints the classic
 * "Size / First Load JS" table, so this script derives the same figure from the
 * build output itself:
 *
 *   first-load JS = buildManifest.rootMainFiles
 *                 + every client chunk referenced by the route's
 *                   `page_client-reference-manifest.js`
 *
 * That is exactly the set of scripts the document requests on a cold load.
 * Verified byte-for-byte against a running `next start` on 2026-10-29 for the
 * four public routes (`/en`, `/en/login`, `/en/privacy`, `/en/terms`); see
 * docs/performance/README.md.
 *
 * `polyfillFiles` is deliberately excluded: Next emits that chunk with
 * `noModule`, so current browsers never fetch it. Including it would add
 * ~110 kB of fiction to every route.
 *
 * Sizes are uncompressed bytes / 1024, matching Next's own reporting
 * convention. Assertions run on raw bytes so the check is independent of the
 * compression settings of whatever serves the build.
 *
 * Usage:
 *   node scripts/perf/bundle-budget.mjs
 *   node scripts/perf/bundle-budget.mjs --json
 *   node scripts/perf/bundle-budget.mjs --write --out perf/bundle-budget.json
 *
 * Exit codes: 0 = every route within budget, 1 = regression, 2 = the build
 * output or budget file is unusable.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_UNUSABLE = 2;

const DEFAULT_NEXT_DIR = path.join("apps", "web", ".next");
const DEFAULT_BUDGET_FILE = path.join("perf", "bundle-budget.json");
/** Head-room written into a freshly generated budget. */
const DEFAULT_TOLERANCE_PCT = 2;

function parseArgs(argv) {
	const options = {
		nextDir: DEFAULT_NEXT_DIR,
		budgetFile: DEFAULT_BUDGET_FILE,
		out: null,
		tolerancePct: DEFAULT_TOLERANCE_PCT,
		write: false,
		json: false,
		quiet: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = () => {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error(`missing value for ${arg}`);
			}
			i += 1;
			return value;
		};
		switch (arg) {
			case "--next-dir":
				options.nextDir = next();
				break;
			case "--budget":
				options.budgetFile = next();
				break;
			case "--out":
				options.out = next();
				break;
			case "--tolerance":
				options.tolerancePct = Number(next());
				if (!Number.isFinite(options.tolerancePct) || options.tolerancePct < 0) {
					throw new Error("--tolerance must be a non-negative number");
				}
				break;
			case "--write":
				options.write = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--quiet":
				options.quiet = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return options;
}

function usage() {
	return [
		"Usage: node scripts/perf/bundle-budget.mjs [options]",
		"",
		"Options:",
		"  --next-dir <dir>    Next build output (default: apps/web/.next)",
		"  --budget <file>     Budget file (default: perf/bundle-budget.json)",
		"  --write             Print a fresh budget built from this build",
		"  --out <file>        With --write, also write the budget to this path",
		"  --tolerance <pct>   Head-room for --write (default: 2)",
		"  --json              Machine-readable report on stdout",
		"  --quiet             Only print failures",
	].join("\n");
}

/**
 * `.next` stores chunk URLs as `/_next/static/chunks/x.js`; on disk that is
 * `static/chunks/x.js` relative to the build directory.
 */
function chunkPath(url) {
	return url.replace(/^\/_next\//, "").replace(/^\//, "");
}

function toKb(bytes) {
	return Math.round((bytes / 1024) * 10) / 10;
}

/** `/[locale]/(dashboard)/dashboard/page` -> `/en/dashboard` (locale = en). */
export function routeToUrl(route) {
	const segments = route
		.split("/")
		.filter(Boolean)
		.filter((segment) => !/^\(.*\)$/.test(segment));
	if (segments.length > 0 && segments[segments.length - 1] === "page") {
		segments.pop();
	}
	if (segments.length > 0 && segments[0] === "[locale]") {
		segments[0] = "en";
	}
	return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

function readJson(file, what) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") {
			throw new Error(`${what} not found: ${file}`);
		}
		throw new Error(`${what} is not valid JSON (${file}): ${error.message}`);
	}
}

/**
 * `page_client-reference-manifest.js` assigns to `globalThis.__RSC_MANIFEST`.
 * It is a generated script, not a module, so it is evaluated in an isolated
 * function scope instead of being imported.
 */
function readClientReferenceManifest(file) {
	const source = fs.readFileSync(file, "utf8");
	const holder = { __RSC_MANIFEST: {} };
	// The manifest body only touches `globalThis`; no other global is read.
	new Function("globalThis", source)(holder);
	return holder.__RSC_MANIFEST;
}

function findPageManifests(root) {
	const found = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name === "page_client-reference-manifest.js") {
				found.push(full);
			}
		}
	};
	walk(root);
	return found.sort();
}

function readBuild(nextDir) {
	if (!fs.existsSync(nextDir)) {
		throw new Error(
			`no build output at ${nextDir}. Run \`next build\` in apps/web first (CI does this with dummy env).`,
		);
	}
	const buildManifestPath = path.join(nextDir, "build-manifest.json");
	const buildManifest = readJson(buildManifestPath, "build manifest");
	const rootMainFiles = (buildManifest.rootMainFiles ?? []).map(chunkPath);
	if (rootMainFiles.length === 0) {
		throw new Error(
			`${buildManifestPath} has no rootMainFiles; this is not a usable Next build directory.`,
		);
	}

	const sizeOf = (relative) => {
		const absolute = path.join(nextDir, relative);
		let stat;
		try {
			stat = fs.statSync(absolute);
		} catch {
			throw new Error(
				`chunk listed by the build is missing on disk: ${relative} (looked for ${absolute})`,
			);
		}
		if (!stat.isFile()) {
			throw new Error(`chunk path is not a file: ${relative}`);
		}
		return stat.size;
	};

	const sharedFiles = rootMainFiles.map((file) => ({ file, bytes: sizeOf(file) }));
	const sharedBytes = sharedFiles.reduce((total, entry) => total + entry.bytes, 0);

	const pagesRoot = path.join(nextDir, "server", "app");
	if (!fs.existsSync(pagesRoot)) {
		throw new Error(`no app router output at ${pagesRoot}; run \`next build\` in apps/web first.`);
	}

	const routes = new Map();
	for (const manifestFile of findPageManifests(pagesRoot)) {
		const manifest = readClientReferenceManifest(manifestFile);
		for (const [route, entry] of Object.entries(manifest)) {
			const chunks = new Set();
			for (const mod of Object.values(entry?.clientModules ?? {})) {
				for (const chunk of mod?.chunks ?? []) {
					chunks.add(chunkPath(chunk));
				}
			}
			const shared = new Set(rootMainFiles);
			const ownFiles = [...chunks]
				.filter((file) => !shared.has(file))
				.sort()
				.map((file) => ({ file, bytes: sizeOf(file) }));
			const ownBytes = ownFiles.reduce((total, item) => total + item.bytes, 0);
			// A single route key must map to exactly one manifest; a duplicate means
			// two route trees disagree and the report would be ambiguous.
			if (routes.has(route)) {
				throw new Error(`route ${route} appears in more than one client reference manifest`);
			}
			routes.set(route, {
				route,
				url: routeToUrl(route),
				sharedBytes,
				ownBytes,
				firstLoadBytes: sharedBytes + ownBytes,
				firstLoadKb: toKb(sharedBytes + ownBytes),
				sharedFiles,
				ownFiles,
			});
		}
	}

	if (routes.size === 0) {
		throw new Error(`no routes found under ${pagesRoot}; refusing to report an empty result.`);
	}

	return { sharedBytes, sharedKb: toKb(sharedBytes), sharedFiles, routes };
}

/** Budget for one measured value: measured + tolerance, rounded up to 0.1 kB. */
function budgetFor(measuredKb, tolerancePct) {
	const budget = measuredKb * (1 + tolerancePct / 100);
	return Math.ceil(budget * 10) / 10;
}

function buildBudget(build, tolerancePct, meta) {
	const routes = {};
	for (const route of [...build.routes.values()].sort((a, b) => a.route.localeCompare(b.route))) {
		routes[route.route] = {
			baselineKb: route.firstLoadKb,
			budgetKb: budgetFor(route.firstLoadKb, tolerancePct),
		};
	}
	// A route that is not listed must still not be able to import a heavy
	// library unnoticed. The fallback is the worst measured route plus the same
	// tolerance, so a new page inherits the current ceiling until someone adds
	// an explicit entry for it.
	const worst = Math.max(...[...build.routes.values()].map((route) => route.firstLoadKb));
	return {
		$comment:
			"First-load JS budgets (uncompressed kB, 1 kB = 1024 B). Generated from a real build by scripts/perf/bundle-budget.mjs --write. Raising a number here is a reviewed decision: it must be justified in the PR that needs it, never silently refreshed. See docs/performance/README.md.",
		metric: "first-load-js",
		unit: "kB",
		tolerancePct,
		generatedFrom: meta,
		shared: {
			baselineKb: build.sharedKb,
			budgetKb: budgetFor(build.sharedKb, tolerancePct),
		},
		defaultMaxKb: budgetFor(worst, tolerancePct),
		routes,
	};
}

function compare(build, budget) {
	const failures = [];
	const warnings = [];
	const rows = [];

	if (typeof budget.defaultMaxKb !== "number") {
		throw new Error("budget file is missing defaultMaxKb");
	}
	if (typeof budget.shared?.budgetKb !== "number") {
		throw new Error("budget file is missing shared.budgetKb");
	}

	if (build.sharedKb > budget.shared.budgetKb) {
		failures.push({
			scope: "shared",
			measuredKb: build.sharedKb,
			budgetKb: budget.shared.budgetKb,
		});
	}

	const budgetRoutes = budget.routes ?? {};
	for (const route of [...build.routes.values()].sort((a, b) => a.route.localeCompare(b.route))) {
		const entry = budgetRoutes[route.route];
		const budgetKb = entry ? entry.budgetKb : budget.defaultMaxKb;
		const over = route.firstLoadKb - budgetKb;
		rows.push({
			route: route.route,
			url: route.url,
			measuredKb: route.firstLoadKb,
			budgetKb,
			deltaKb: Math.round(over * 10) / 10,
			source: entry ? "budget" : "defaultMaxKb",
			ok: over <= 0,
		});
		if (over > 0) {
			failures.push({
				scope: route.route,
				measuredKb: route.firstLoadKb,
				budgetKb,
			});
		}
	}

	const seen = new Set([...build.routes.keys()]);
	for (const route of Object.keys(budgetRoutes)) {
		if (!seen.has(route)) {
			warnings.push(`budget lists ${route}, but the build has no such route (stale entry)`);
		}
	}

	const biggest = [...rows].sort((a, b) => b.measuredKb - a.measuredKb).slice(0, 10);
	return { failures, warnings, rows, biggest };
}

function printTable(rows) {
	const header = ["route", "url", "kb", "budget", "delta", "source"];
	const widths = [
		Math.max(header[0].length, ...rows.map((row) => row.route.length)),
		Math.max(header[1].length, ...rows.map((row) => row.url.length)),
		8,
		8,
		8,
		12,
	];
	const pad = (value, width) => String(value).padEnd(width);
	const line = (cells) =>
		cells
			.map((cell, i) => pad(cell, widths[i]))
			.join("  ")
			.trimEnd();
	const out = [line(header)];
	for (const row of rows) {
		out.push(
			line([
				row.route,
				row.url,
				row.measuredKb.toFixed(1),
				row.budgetKb.toFixed(1),
				`${row.deltaKb > 0 ? "+" : ""}${row.deltaKb.toFixed(1)}`,
				row.source,
			]),
		);
	}
	return out.join("\n");
}

function describeEnvironment() {
	return {
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
	};
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`bundle-budget: ${error.message}\n\n${usage()}`);
		return EXIT_UNUSABLE;
	}
	if (options.help) {
		console.log(usage());
		return EXIT_OK;
	}

	let build;
	try {
		build = readBuild(options.nextDir);
	} catch (error) {
		console.error(`bundle-budget: ${error.message}`);
		return EXIT_UNUSABLE;
	}

	if (options.write) {
		const budget = buildBudget(build, options.tolerancePct, describeEnvironment());
		const text = `${JSON.stringify(budget, null, "\t")}\n`;
		if (options.out) {
			fs.mkdirSync(path.dirname(options.out), { recursive: true });
			fs.writeFileSync(options.out, text);
			console.error(
				`bundle-budget: wrote ${Object.keys(budget.routes).length} route budgets to ${options.out}`,
			);
		} else {
			process.stdout.write(text);
		}
		return EXIT_OK;
	}

	let budget;
	try {
		budget = readJson(options.budgetFile, "budget file");
	} catch (error) {
		console.error(`bundle-budget: ${error.message}`);
		return EXIT_UNUSABLE;
	}

	let report;
	try {
		report = compare(build, budget);
	} catch (error) {
		console.error(`bundle-budget: ${error.message}`);
		return EXIT_UNUSABLE;
	}

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					ok: report.failures.length === 0,
					sharedKb: build.sharedKb,
					sharedBudgetKb: budget.shared.budgetKb,
					routes: report.rows,
					failures: report.failures,
					warnings: report.warnings,
				},
				null,
				2,
			),
		);
	} else {
		if (!options.quiet) {
			console.log(
				`first-load JS: ${build.routes.size} routes, ${build.sharedKb.toFixed(1)} kB shared ` +
					`(budget ${budget.shared.budgetKb.toFixed(1)} kB)`,
			);
			console.log("");
			console.log(printTable(report.rows));
			console.log("");
		}
		for (const warning of report.warnings) {
			console.error(`warning: ${warning}`);
		}
	}

	for (const failure of report.failures) {
		console.error(
			`::error::${failure.scope} first-load JS is ${failure.measuredKb.toFixed(1)} kB, ` +
				`budget ${failure.budgetKb.toFixed(1)} kB ` +
				`(+${(failure.measuredKb - failure.budgetKb).toFixed(1)} kB over)`,
		);
	}

	if (report.failures.length > 0) {
		console.error("");
		console.error(
			`bundle-budget: ${report.failures.length} regression(s). Either shrink the bundle or argue the increase in the PR and refresh perf/bundle-budget.json with --write.`,
		);
		return EXIT_REGRESSION;
	}

	if (!options.json && !options.quiet) {
		console.log(`All ${build.routes.size} routes are within budget.`);
	}
	return EXIT_OK;
}

process.exitCode = main();
