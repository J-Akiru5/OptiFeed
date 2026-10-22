#!/usr/bin/env node
/**
 * Live contract + latency suites (§11.1, §11.2, §11.3).
 *
 * Guarantees:
 *  - measured/skipped/total is reported for every suite (§2.1);
 *  - coverage below 90 % fails even in warn mode (§11.3 rule 5);
 *  - every assertion goes through one warn/fail gate (§11.3 rule 2);
 *  - a missing test credential shows up as failed coverage, never a green run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	SKIP_STATUSES,
	coverage,
	createGate,
	decodeJson,
	parseArgs,
	parseServerTiming,
	percentile,
	printCoverage,
	printServerTiming,
	requestOnce,
	resolveConfig,
	summarize,
	toMarkdownTable,
} from "./lib.mjs";

const ROOT = process.cwd();
const ENDPOINTS_FILE = join(ROOT, "scripts", "api", "endpoints.json");
const config = resolveConfig(parseArgs(process.argv.slice(2)));
const gate = createGate(config.mode);
const inventory = JSON.parse(readFileSync(ENDPOINTS_FILE, "utf8"));

const results = {
	generatedAt: new Date().toISOString(),
	baseUrl: config.baseUrl,
	mode: config.mode,
	suites: {},
	rows: [],
	coverageFailures: [],
};

console.log(`API regulation live check — ${config.baseUrl} (mode: ${config.mode})\n`);

if (config.mode === "warn") {
	console.log("Rollout mode: breaches are reported but do not fail CI. Coverage always fails.\n");
}

const credentialMissing =
	!config.cookie &&
	!config.bearer &&
	inventory.endpoints.some((endpoint) => endpoint.auth === "session");
if (credentialMissing) {
	console.log(
		"WARN  No API_TEST_COOKIE / API_TEST_BEARER set. Session endpoints will be skipped and coverage will fail.\n",
	);
}

if (config.suite === "all" || config.suite === "contract") {
	await runContractSuite();
}
if (config.suite === "all" || config.suite === "latency") {
	await runLatencySuite();
}
await runContractAssertions();

report();

// ─── Contract suite (§11.2) ──────────────────────────────────────────────────

async function runContractSuite() {
	const endpoints = inventory.endpoints.filter((endpoint) => endpoint.contract);
	console.log(`Contract suite — ${endpoints.length} declared endpoint(s)`);
	let measured = 0;
	let skipped = 0;

	for (const endpoint of endpoints) {
		const response = await requestOnce(config, endpoint);
		const route = `${endpoint.method} ${endpoint.path}`;

		if (response.status === 0) {
			skipped += 1;
			console.log(
				`  SKIP  ${route} — environment unavailable (${response.error ?? "network error"})`,
			);
			results.rows.push({ suite: "contract", endpoint: route, status: "SKIP ENV" });
			continue;
		}

		if (SKIP_STATUSES.has(response.status)) {
			skipped += 1;
			console.log(`  SKIP  ${route} — HTTP ${response.status}`);
			results.rows.push({ suite: "contract", endpoint: route, status: `SKIP ${response.status}` });
			continue;
		}

		measured += 1;
		gate.enforce(response.status < 500, `${route} returned < 500`, `HTTP ${response.status}`);

		assertInstrumentation(endpoint, route, response);

		const body = decodeJson(response.body);

		if (response.status >= 400) {
			gate.enforce(
				body?.error && typeof body.error.code === "string",
				`${route} error body has error.code`,
			);
			gate.enforce(
				typeof body?.error?.message === "string",
				`${route} error body has error.message`,
			);
			gate.enforce(
				typeof body?.error?.request_id === "string",
				`${route} error body has error.request_id`,
			);
		} else if (endpoint.shape === "envelope") {
			gate.enforce(body && "data" in body, `${route} success body has data`);
			gate.enforce(body && "meta" in body, `${route} success body has meta`);
			gate.enforce(
				typeof body?.meta?.request_id === "string",
				`${route} meta.request_id is present`,
			);
		} else if (endpoint.shape === "flat") {
			gate.enforce(body !== null, `${route} returns JSON`, "body is not JSON");
		}

		console.log(`  OK    ${route} — HTTP ${response.status}`);
		results.rows.push({ suite: "contract", endpoint: route, status: `OK ${response.status}` });
	}

	recordSuite("contract", measured, skipped, endpoints.length);
}

// ─── Latency suite (§11.1) ───────────────────────────────────────────────────

async function runLatencySuite() {
	const endpoints = inventory.endpoints.filter((endpoint) => endpoint.latency);
	console.log(`\nLatency suite — ${endpoints.length} declared endpoint(s)`);
	let measured = 0;
	let skipped = 0;

	for (const endpoint of endpoints) {
		const route = `${endpoint.method} ${endpoint.path}`;
		const first = await requestOnce(config, endpoint);

		if (first.status === 0) {
			skipped += 1;
			console.log(`  SKIP  ${route} — environment unavailable (${first.error ?? "network error"})`);
			continue;
		}

		if (SKIP_STATUSES.has(first.status)) {
			skipped += 1;
			console.log(`  SKIP  ${route} — HTTP ${first.status}`);
			continue;
		}

		gate.enforce(first.status < 500, `${route} probe returned < 500`, `HTTP ${first.status}`);

		for (let i = 0; i < config.warmup; i++) {
			await requestOnce(config, endpoint);
		}

		const timings = [];
		let last;
		let serverTiming = {};
		let environmentFailure = false;
		for (let i = 0; i < config.samples; i++) {
			last = await requestOnce(config, endpoint);
			if (last.status === 0) {
				environmentFailure = true;
				break;
			}
			timings.push(last.elapsedMs);
			gate.enforce(last.status < 500, `${route} sample returned < 500`, `HTTP ${last.status}`);
			serverTiming = parseServerTiming(last.headers.get("server-timing"));
		}

		if (environmentFailure || timings.length === 0) {
			skipped += 1;
			console.log(`  SKIP  ${route} — environment unavailable during sampling`);
			continue;
		}

		measured += 1;
		const summary = summarize(timings);
		const p95 = percentile(timings, 95);
		const max = Math.max(...timings);

		gate.enforce(
			p95 <= config.p95Ms,
			`${route} p95 <= ${config.p95Ms} ms`,
			`measured ${Math.round(p95)} ms`,
		);
		gate.enforce(
			max <= config.maxMs,
			`${route} max <= ${config.maxMs} ms`,
			`measured ${Math.round(max)} ms`,
		);

		console.log(
			`  ${route} — p50 ${summary.p50} ms, p95 ${summary.p95} ms, p99 ${summary.p99} ms, max ${summary.max} ms`,
		);
		const timing = printServerTiming(serverTiming);
		if (timing) console.log(`    Server-Timing: ${timing}`);

		results.rows.push({
			suite: "latency",
			endpoint: route,
			status: String(last.status),
			p50: summary.p50,
			p95: summary.p95,
			p99: summary.p99,
			max: summary.max,
			serverTiming: timing,
		});
	}

	recordSuite("latency", measured, skipped, endpoints.length);
}

// ─── Contract assertions beyond the endpoint list (§11.2) ────────────────────

async function runContractAssertions() {
	console.log("\nContract assertions");
	const notFound = await requestOnce(config, {
		method: "GET",
		path: "/api/v1/this-route-does-not-exist",
		auth: "none",
	});
	const body = decodeJson(notFound.body);

	gate.enforce(
		notFound.status === 404,
		"unknown versioned path returns 404",
		`HTTP ${notFound.status}`,
	);
	gate.enforce(
		body?.error?.code === "NOT_FOUND",
		"unknown path uses the error envelope",
		body?.error?.code ?? "missing error.code",
	);
	gate.enforce(typeof body?.error?.request_id === "string", "unknown path error has request_id");
	gate.enforce(
		Boolean(notFound.headers.get("server-timing")),
		"unknown path carries Server-Timing",
	);
	gate.enforce(Boolean(notFound.headers.get("x-request-id")), "unknown path carries X-Request-Id");
	console.log("  checked unknown-path 404 envelope and instrumentation");
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function assertInstrumentation(endpoint, route, response) {
	gate.enforce(Boolean(response.headers.get("server-timing")), `${route} has Server-Timing`);
	gate.enforce(Boolean(response.headers.get("x-request-id")), `${route} has X-Request-Id`);
	if (endpoint.shape === "file") {
		const contentType = response.headers.get("content-type") ?? "";
		gate.enforce(
			!contentType.includes("application/json"),
			`${route} returns a file body`,
			contentType,
		);
	}
}

function recordSuite(name, measured, skipped, total) {
	const ratio = coverage(measured, skipped, total);
	const covered = ratio >= 0.9;
	printCoverage(`${name} coverage`, measured, skipped, total);
	if (!covered) {
		results.coverageFailures.push({
			suite: name,
			measured,
			skipped,
			total,
			ratio: Number(ratio.toFixed(3)),
		});
		// §11.3 rule 5: coverage fails in both modes.
		console.log(
			`  FAIL  ${name} coverage floor — ${(ratio * 100).toFixed(1)}% < 90%. A skipped endpoint is not certified.`,
		);
	} else {
		console.log(`  PASS  ${name} coverage floor`);
	}
	results.suites[name] = {
		measured,
		skipped,
		total,
		coverage: Number(ratio.toFixed(3)),
		coveragePassed: covered,
	};
}

function report() {
	const latencyRows = results.rows.filter((row) => row.suite === "latency");
	if (latencyRows.length > 0) {
		console.log("\nLatency results");
		console.log(toMarkdownTable(latencyRows));
	}

	if (config.report) {
		writeFileSync(config.report, `${JSON.stringify(results, null, 2)}\n`);
		console.log(`\nJSON report written to ${config.report}`);
	}

	console.log(`\nViolations: ${gate.violations.length}`);
	console.log(`Coverage failures: ${results.coverageFailures.length}`);

	if (results.coverageFailures.length > 0) {
		console.log(
			"\nFAILED: insufficient coverage. Measure at least 90 % of the declared endpoints.",
		);
		process.exit(1);
	}
	if (config.mode === "fail" && gate.violations.length > 0) {
		console.log("\nFAILED: one or more API regulation checks are in breach.");
		process.exit(1);
	}
	if (config.mode === "warn" && gate.violations.length > 0) {
		console.log("\nWarn mode: breaches recorded, CI stays green.");
	}
	console.log("\nLive check passed.");
}
