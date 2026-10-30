#!/usr/bin/env node
/**
 * API + page latency harness (p50/p95/p99) with a recorded baseline and a
 * regression gate.
 *
 * Why the endpoint list is short: this repository is measured without a
 * database and without a Supabase project. An endpoint only qualifies for the
 * baseline when it reaches a *real* handler result on a stack with no database
 * — otherwise the number measures a failure path and a gate on it would be
 * meaningless. The catalogue below records both kinds explicitly so the
 * follow-up is executable rather than aspirational; see
 * docs/performance/api-latency.md.
 *
 * Two numbers are reported per endpoint:
 *   clientMs – wall time from request start to a fully-read body (what a
 *              caller experiences, including loopback and the framework)
 *   serverMs – `Server-Timing: total;dur=` from `withApi`
 *              (apps/web/lib/api/instrumentation.ts), i.e. the handler's own
 *              budget. This is the number that isolates our code from the
 *              transport.
 *
 * The gate compares p95 against `max(floorMs, baselineP95 * factor)`, with both
 * parameters stored in the baseline file so the rule is reviewable. Status
 * contracts are checked separately and are not negotiable.
 *
 * Usage:
 *   node scripts/perf/api-latency.mjs --spawn --json
 *   node scripts/perf/api-latency.mjs --base-url http://127.0.0.1:3111
 *   node scripts/perf/api-latency.mjs --write --out perf/baseline/api-latency.json
 *   node scripts/perf/api-latency.mjs --baseline perf/baseline/api-latency.json
 *
 * Exit codes: 0 = within budget, 1 = regression, 2 = the harness could not run.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseServerTiming, round, summarize } from "../api/lib.mjs";

const EXIT_OK = 0;
const EXIT_REGRESSION = 1;
const EXIT_UNUSABLE = 2;

const DEFAULT_PORT = 3111;
const DEFAULT_ITERATIONS = 60;
const DEFAULT_WARMUP = 10;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Absolute floor for the p95 gate; see docs/performance/api-latency.md. */
const DEFAULT_FLOOR_MS = 50;
const DEFAULT_FACTOR = 1.5;

/**
 * The measured surface.
 *
 * `gated: true` endpoints must hold their baseline. `gated: false` endpoints
 * are still measured and printed — the number is evidence even when it cannot
 * be a gate on this stack — but they never fail the run.
 */
const ENDPOINTS = [
	{
		name: "api-not-found",
		method: "GET",
		path: "/api/__perf_probe_missing__",
		kind: "api",
		gated: true,
		expectedStatuses: [404],
		description:
			"The `[...fallback]` handler: full `withApi` pipeline, error envelope, zero database access.",
	},
	{
		name: "api-not-found-post",
		method: "POST",
		path: "/api/__perf_probe_missing__",
		kind: "api",
		gated: true,
		expectedStatuses: [404],
		description: "Same route through the POST export path, so method dispatch is covered.",
		body: "{}",
	},
	{
		name: "page-landing",
		method: "GET",
		path: "/en",
		kind: "page",
		gated: false,
		expectedStatuses: [200],
		description:
			"Public landing page render. Recorded as evidence, not gated: server-side React for a large client component swings about 3x under unrelated load on a shared machine (43-119 ms p50 observed with no code change). The page-level gate is Lighthouse `server-response-time` <= 1000 ms.",
	},
	{
		name: "page-login",
		method: "GET",
		path: "/en/login",
		kind: "page",
		gated: false,
		expectedStatuses: [200],
		description: "Public login page render. Recorded as evidence; see `page-landing`.",
	},
	{
		name: "page-privacy",
		method: "GET",
		path: "/en/privacy",
		kind: "page",
		gated: false,
		expectedStatuses: [200],
		description: "Public legal page render. Recorded as evidence; see `page-landing`.",
	},
	{
		name: "page-terms",
		method: "GET",
		path: "/en/terms",
		kind: "page",
		gated: false,
		expectedStatuses: [200],
		description: "Public legal page render. Recorded as evidence; see `page-landing`.",
	},
	{
		name: "page-dashboard-guard",
		method: "GET",
		path: "/en/dashboard",
		kind: "page",
		gated: true,
		expectedStatuses: [307],
		description:
			"Unauthenticated dashboard: measures the proxy/navigation-guard redirect, i.e. the cost of refusing a request.",
	},
	{
		name: "api-health-degraded",
		method: "GET",
		path: "/api/health",
		kind: "api",
		gated: false,
		expectedStatuses: [200, 503, 504],
		description:
			"Diagnostic only. With no database, a cold Prisma engine makes the probe outlive the route's 2 s budget and the route answers 504; once the engine has failed once, the same probe answers 503 in a few milliseconds. Both are the failure path, not a healthy-path baseline. Re-enable the gate once a database is reachable (`--enable api-health-degraded`).",
		// Each sample waits out the 2 s route budget, so this endpoint gets the
		// minimum that still yields a percentile.
		iterations: 10,
		warmup: 2,
	},
];

/**
 * Endpoints that need a database or an authenticated session. They are not
 * executed here; they are listed so `docs/performance/api-latency.md` and the
 * CI follow-up cannot silently forget them.
 */
const DEFERRED = [
	{
		name: "api-ingest",
		method: "POST",
		path: "/api/ingest",
		requires: "database + provisioned device token",
		why: "The hottest write path (heartbeat, dispense, schedule ack) and the only one whose cost scales with fleet size.",
	},
	{
		name: "api-feed-command",
		method: "POST",
		path: "/api/feed-command",
		requires: "database + device token",
		why: "Poll endpoint the feeder hits on a timer; its p95 is the device-visible latency.",
	},
	{
		name: "api-calendar-events",
		method: "GET",
		path: "/api/calendar/events",
		requires: "database + authenticated session",
		why: "Fan-out read over Pond, CropCycle, EnergyDevice and PondEvent for one month window.",
	},
	{
		name: "api-jobs-metrics",
		method: "GET",
		path: "/api/jobs/metrics",
		requires: "database + authenticated session",
		why: "Aggregates BackgroundJob/JobArtifact for the export queue.",
	},
	{
		name: "page-dashboard",
		method: "GET",
		path: "/en/dashboard",
		requires: "database + authenticated session",
		why: "The heaviest server render (feeder hero, charts, FCR, biomass, firmware).",
	},
];

function parseArgs(argv) {
	const options = {
		baseUrl: null,
		port: DEFAULT_PORT,
		iterations: DEFAULT_ITERATIONS,
		warmup: DEFAULT_WARMUP,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		spawn: false,
		baseline: null,
		out: null,
		write: false,
		json: false,
		quiet: false,
		strict: false,
		enable: [],
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const value = () => {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`missing value for ${arg}`);
			}
			i += 1;
			return next;
		};
		const positiveInt = (label) => {
			const parsed = Number(value());
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error(`${label} must be a positive integer`);
			}
			return parsed;
		};
		switch (arg) {
			case "--base-url":
				options.baseUrl = value();
				break;
			case "--port":
				options.port = positiveInt("--port");
				break;
			case "--iterations":
				options.iterations = positiveInt("--iterations");
				break;
			case "--warmup": {
				const parsed = Number(value());
				if (!Number.isInteger(parsed) || parsed < 0) {
					throw new Error("--warmup must be a non-negative integer");
				}
				options.warmup = parsed;
				break;
			}
			case "--timeout":
				options.timeoutMs = positiveInt("--timeout");
				break;
			case "--spawn":
				options.spawn = true;
				break;
			case "--baseline":
				options.baseline = value();
				break;
			case "--out":
				options.out = value();
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
			case "--strict":
				options.strict = true;
				break;
			case "--enable":
				options.enable.push(value());
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	options.baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}`;
	return options;
}

function usage() {
	return [
		"Usage: node scripts/perf/api-latency.mjs [options]",
		"",
		"Options:",
		"  --base-url <url>    Target (default: http://127.0.0.1:<port>)",
		"  --spawn             Start `pnpm --filter web start` and stop it on exit",
		"  --port <n>          Port for --spawn and the default base URL (default: 3111)",
		"  --iterations <n>    Timed requests per endpoint (default: 60)",
		"  --warmup <n>        Untimed requests per endpoint (default: 10)",
		"  --timeout <ms>      Per-request timeout (default: 15000)",
		"  --write             Emit a baseline built from this run",
		"  --out <file>        With --write, also write the baseline to this path",
		"  --baseline <file>   Gate this run against a recorded baseline",
		"  --strict            Ignore the baseline's floorMs (exact p95 comparison)",
		"  --enable <name>     Gate an endpoint that is ungated by default",
		"  --json              Machine-readable report on stdout",
		"  --quiet             Only print failures",
	].join("\n");
}

function readJson(file, what) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") throw new Error(`${what} not found: ${file}`);
		throw new Error(`${what} is not valid JSON (${file}): ${error.message}`);
	}
}

/**
 * Percentiles come from the shared API-regulation helper so the latency suite
 * (`scripts/api/live-check.mjs`) and this DB-free harness can never disagree
 * about what p95 means. Only `mean` is local: `summarize()` does not report it
 * and the baseline wants it as a sanity check on the spread.
 */
function summarise(samples) {
	const finite = samples.filter(Number.isFinite);
	if (finite.length === 0) {
		return { count: 0, p50: null, p95: null, p99: null, min: null, max: null, mean: null };
	}
	const sum = finite.reduce((total, value) => total + value, 0);
	return { ...summarize(finite), mean: round(sum / finite.length) };
}

function readServerTimingMs(response) {
	const header = response.headers.get("server-timing");
	if (!header) return null;
	const total = parseServerTiming(header).total;
	return Number.isFinite(total) ? total : null;
}

async function requestOnce(endpoint, options) {
	const url = new URL(endpoint.path, options.baseUrl);
	const init = {
		method: endpoint.method,
		redirect: "manual",
		signal: AbortSignal.timeout(options.timeoutMs),
		headers: { accept: "*/*" },
	};
	if (endpoint.body !== undefined) {
		init.body = endpoint.body;
		init.headers["content-type"] = "application/json";
	}

	const started = performance.now();
	const response = await fetch(url, init);
	// Read the body so the number includes the bytes a caller actually waits for.
	await response.arrayBuffer();
	const clientMs = performance.now() - started;

	return {
		status: response.status,
		clientMs,
		serverMs: readServerTimingMs(response),
	};
}

async function measure(endpoint, options) {
	const clientSamples = [];
	const serverSamples = [];
	const statusCounts = new Map();
	let transportError = null;
	const iterations = endpoint.iterations ?? options.iterations;
	const warmup = endpoint.warmup ?? options.warmup;

	for (let i = 0; i < warmup; i += 1) {
		try {
			await requestOnce(endpoint, options);
		} catch {
			// A warm-up failure is reported by the timed loop; warming up must not
			// hide or duplicate it.
		}
	}

	for (let i = 0; i < iterations; i += 1) {
		try {
			const result = await requestOnce(endpoint, options);
			clientSamples.push(result.clientMs);
			if (result.serverMs !== null) serverSamples.push(result.serverMs);
			statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
		} catch (error) {
			transportError = error instanceof Error ? error.message : String(error);
			break;
		}
	}

	return {
		name: endpoint.name,
		method: endpoint.method,
		path: endpoint.path,
		kind: endpoint.kind,
		gated: endpoint.gated,
		expectedStatuses: endpoint.expectedStatuses,
		description: endpoint.description,
		observedStatuses: [...statusCounts.keys()].sort((a, b) => a - b),
		statusCounts: Object.fromEntries([...statusCounts.entries()].sort((a, b) => a[0] - b[0])),
		clientMs: summarise(clientSamples),
		serverMs: summarise(serverSamples),
		transportError,
	};
}

function describeEnvironment(options, serverInfo) {
	const cpus = os.cpus();
	return {
		recordedAt: new Date().toISOString(),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		cpu: cpus.length > 0 ? cpus[0].model.trim() : "unknown",
		cpuCount: cpus.length,
		totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
		baseUrl: options.baseUrl,
		iterations: options.iterations,
		warmup: options.warmup,
		server: serverInfo,
	};
}

function buildBaseline(results, options, serverInfo) {
	const endpoints = {};
	for (const result of results) {
		const gated = result.gated || options.enable.includes(result.name);
		endpoints[result.name] = {
			gated,
			method: result.method,
			path: result.path,
			kind: result.kind,
			expectedStatuses: result.expectedStatuses,
			observedStatuses: result.observedStatuses,
			clientMs: result.clientMs,
			serverMs: result.serverMs,
		};
	}
	return {
		$comment:
			"Recorded latency baseline. `gate` is the rule the CI check applies: fail when p95 exceeds max(floorMs, baselineP95 * factor). Regenerate with scripts/perf/api-latency.mjs --write; see docs/performance/api-latency.md for the environment and the endpoints that still need a database.",
		environment: describeEnvironment(options, serverInfo),
		gate: {
			metric: "clientMs.p95",
			floorMs: DEFAULT_FLOOR_MS,
			factor: DEFAULT_FACTOR,
			note: "floorMs absorbs cross-machine variance for sub-10 ms endpoints; factor catches order-of-magnitude regressions above the floor. --strict ignores floorMs.",
		},
		endpoints,
		deferred: DEFERRED,
	};
}

function gateAgainst(results, baseline, options) {
	const failures = [];
	const rows = [];
	const floorMs = options.strict ? 0 : (baseline.gate?.floorMs ?? DEFAULT_FLOOR_MS);
	const factor = baseline.gate?.factor ?? DEFAULT_FACTOR;

	for (const result of results) {
		const recorded = baseline.endpoints?.[result.name];
		const gated = result.gated || options.enable.includes(result.name);
		if (!gated) {
			rows.push({ ...result, gated: false, thresholdMs: null, status: "diagnostic" });
			continue;
		}
		if (!recorded) {
			failures.push({
				name: result.name,
				reason: "no baseline entry for this endpoint",
			});
			rows.push({ ...result, gated: true, thresholdMs: null, status: "missing-baseline" });
			continue;
		}

		const expected = recorded.expectedStatuses ?? [];
		const unexpected = result.observedStatuses.filter((status) => !expected.includes(status));
		const threshold = Math.max(floorMs, round((recorded.clientMs?.p95 ?? 0) * factor));

		let status = "ok";
		if (result.transportError) {
			status = "transport-error";
			failures.push({ name: result.name, reason: `transport error: ${result.transportError}` });
		} else if (unexpected.length > 0) {
			status = "status";
			failures.push({
				name: result.name,
				reason: `unexpected status ${unexpected.join(", ")} (expected ${expected.join(", ")} or a subset)`,
			});
		} else if (result.clientMs.p95 > threshold) {
			status = "slow";
			failures.push({
				name: result.name,
				reason: `p95 ${result.clientMs.p95} ms over threshold ${threshold} ms (baseline ${recorded.clientMs?.p95} ms)`,
			});
		}

		rows.push({ ...result, gated: true, thresholdMs: threshold, status });
	}

	return { failures, rows };
}

function printReport(rows, baseline, options) {
	const title = baseline ? "latency vs baseline" : "latency";
	console.log(
		`${title}: ${options.iterations} timed requests per endpoint after ${options.warmup} warm-up ` +
			`(${options.baseUrl})`,
	);
	console.log("");
	const header = [
		"endpoint",
		"method",
		"status",
		"p50",
		"p95",
		"p99",
		"srv p50",
		"srv p95",
		"gate",
	];
	const body = rows.map((row) => [
		row.name,
		row.method,
		row.observedStatuses.join("/") || "-",
		row.clientMs.p50 === null ? "-" : row.clientMs.p50.toFixed(1),
		row.clientMs.p95 === null ? "-" : row.clientMs.p95.toFixed(1),
		row.clientMs.p99 === null ? "-" : row.clientMs.p99.toFixed(1),
		row.serverMs.p50 === null ? "-" : row.serverMs.p50.toFixed(1),
		row.serverMs.p95 === null ? "-" : row.serverMs.p95.toFixed(1),
		row.thresholdMs === null ? "n/a" : `<= ${row.thresholdMs.toFixed(1)} ${row.status}`,
	]);
	const widths = header.map((label, index) =>
		Math.max(label.length, ...body.map((line) => String(line[index]).length)),
	);
	const pad = (value, width) => String(value).padEnd(width);
	const line = (cells) =>
		cells
			.map((cell, i) => pad(cell, widths[i]))
			.join("  ")
			.trimEnd();
	console.log(line(header));
	for (const cells of body) console.log(line(cells));
	console.log("");
	console.log(
		"client = full round trip; srv = Server-Timing total from withApi; all values in ms.",
	);
}

async function waitForServer(baseUrl, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(new URL("/api/__perf_probe_ready__", baseUrl), {
				redirect: "manual",
				signal: AbortSignal.timeout(2_000),
			});
			await response.arrayBuffer();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw new Error(
		`server did not answer on ${baseUrl} within ${timeoutMs} ms${
			lastError ? ` (last error: ${lastError.message})` : ""
		}`,
	);
}

function startServer(port) {
	// `shell: true` with a single command string (no args array) avoids Node's
	// DEP0190 warning; `port` is a validated integer so there is nothing to
	// escape.
	const command = `pnpm --filter web start -p ${port}`;
	const child = spawn(command, {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
		shell: true,
		// POSIX: a detached shell becomes its own process-group leader, so stop()
		// can signal the whole tree (shell -> pnpm -> next-server) instead of
		// leaving next-server alive with our stdout/stderr pipes attached.
		detached: process.platform !== "win32",
	});
	let output = "";
	const collect = (chunk) => {
		output += chunk.toString();
		if (output.length > 20_000) output = output.slice(-20_000);
	};
	child.stdout?.on("data", collect);
	child.stderr?.on("data", collect);
	child.on("error", (error) => collect(`\nspawn error: ${error.message}\n`));

	return {
		child,
		output: () => output,
		stop: () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			if (process.platform === "win32") {
				spawn(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore", shell: true });
			} else {
				try {
					// Negative pid = the detached process group, including the
					// next-server grandchild that inherits our pipes.
					process.kill(-child.pid, "SIGTERM");
				} catch {
					child.kill("SIGTERM");
				}
			}
			// Release the pipes even if the tree ignored the signal. Open
			// stdout/stderr handles keep this Node process alive after the
			// measurements, which is what held CI for its full 30-minute timeout.
			child.stdout?.destroy();
			child.stderr?.destroy();
			child.unref();
		},
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`api-latency: ${error.message}\n\n${usage()}`);
		return EXIT_UNUSABLE;
	}
	if (options.help) {
		console.log(usage());
		return EXIT_OK;
	}

	let server = null;
	let serverInfo = { started: false };
	if (options.spawn) {
		server = startServer(options.port);
		serverInfo = { started: true, command: `pnpm --filter web start -p ${options.port}` };
		try {
			await waitForServer(options.baseUrl, 90_000);
		} catch (error) {
			server.stop();
			console.error(`api-latency: ${error.message}`);
			if (server.output().trim()) {
				console.error("--- server output ---");
				console.error(server.output().trim());
			}
			return EXIT_UNUSABLE;
		}
	}

	try {
		const results = [];
		for (const endpoint of ENDPOINTS) {
			results.push(await measure(endpoint, options));
		}

		const baseline = options.baseline ? readJson(options.baseline, "baseline file") : null;

		if (options.baseline && !options.write) {
			const { failures, rows } = gateAgainst(results, baseline, options);
			if (options.json) {
				console.log(
					JSON.stringify(
						{ ok: failures.length === 0, baseUrl: options.baseUrl, rows, failures },
						null,
						2,
					),
				);
			} else {
				if (!options.quiet) printReport(rows, baseline, options);
				for (const failure of failures) {
					console.error(`::error::${failure.name}: ${failure.reason}`);
				}
			}
			if (failures.length > 0) {
				console.error(`api-latency: ${failures.length} regression(s) against ${options.baseline}`);
				return EXIT_REGRESSION;
			}
			if (!options.json && !options.quiet) {
				console.log(`All ${rows.filter((row) => row.gated).length} gated endpoints within budget.`);
			}
			return EXIT_OK;
		}

		const generated = buildBaseline(results, options, serverInfo);
		if (options.write) {
			const text = `${JSON.stringify(generated, null, "\t")}\n`;
			if (options.out) {
				fs.mkdirSync(path.dirname(options.out), { recursive: true });
				fs.writeFileSync(options.out, text);
				console.error(
					`api-latency: wrote baseline for ${results.length} endpoints to ${options.out}`,
				);
			} else {
				process.stdout.write(text);
			}
			return EXIT_OK;
		}

		if (options.json) {
			console.log(
				JSON.stringify({ baseUrl: options.baseUrl, endpoints: generated.endpoints }, null, 2),
			);
		} else if (!options.quiet) {
			printReport(
				results.map((result) => ({ ...result, thresholdMs: null, status: "measured" })),
				null,
				options,
			);
			console.log("");
			console.log("Deferred until a database and an authenticated session exist:");
			for (const entry of DEFERRED) {
				console.log(`  ${entry.method} ${entry.path}  (${entry.requires})`);
			}
		}
		return EXIT_OK;
	} catch (error) {
		console.error(`api-latency: ${error instanceof Error ? error.message : String(error)}`);
		return EXIT_UNUSABLE;
	} finally {
		server?.stop();
	}
}

const exitCode = await main();
process.exitCode = exitCode;

// Safety net: if a spawned server (or any other handle) survives stop(), do not
// let the CI job hang until GitHub's timeout. The timer is unref'd, so the
// normal path exits immediately; it only fires when something still holds the
// event loop open.
setTimeout(() => process.exit(exitCode), 5_000).unref();
