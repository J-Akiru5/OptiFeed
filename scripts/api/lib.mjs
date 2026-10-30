import { performance } from "node:perf_hooks";

const DEFAULT_BUDGETS = {
	p95Ms: 300,
	maxMs: 400,
	coverageFloor: 0.9,
	warmup: 5,
	samples: 30,
};

export const SKIP_STATUSES = new Set([401, 403, 404, 405, 422]);

/**
 * One warn/fail gate for every assertion (§11.3 rule 2).
 * Coverage is handled separately because it fails in both modes.
 */
export function createGate(mode) {
	const violations = [];

	function enforce(condition, message, detail) {
		if (condition) return true;
		violations.push({ message, detail });
		const label = mode === "fail" ? "FAIL" : "WARN";
		console.log(`  ${label}  ${message}${detail ? ` — ${detail}` : ""}`);
		return false;
	}

	return { enforce, violations, mode };
}

export function parseArgs(argv) {
	const args = { mode: "warn", suite: "all" };
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

export function resolveConfig(args) {
	const mode = String(args.mode ?? process.env.API_GATE_MODE ?? "warn").toLowerCase();
	if (mode !== "warn" && mode !== "fail") {
		throw new Error(`--mode must be "warn" or "fail" (received "${mode}")`);
	}

	const baseUrl = String(
		args["base-url"] ?? process.env.API_BASE_URL ?? "http://localhost:3000",
	).replace(/\/+$/, "");

	return {
		mode,
		baseUrl,
		suite: String(args.suite ?? "all"),
		endpoint: args.endpoint ? String(args.endpoint) : null,
		cookie: args.cookie ?? process.env.API_TEST_COOKIE ?? "",
		bearer: args.bearer ?? process.env.API_TEST_BEARER ?? "",
		warmup: toInt(args.warmup, DEFAULT_BUDGETS.warmup),
		samples: toInt(args.samples, DEFAULT_BUDGETS.samples),
		p95Ms: toInt(args["p95-budget"], DEFAULT_BUDGETS.p95Ms),
		maxMs: toInt(args["max-budget"], DEFAULT_BUDGETS.maxMs),
		report: args.report ? String(args.report) : null,
	};
}

function authHeaders(config, endpoint) {
	const headers = { Accept: "application/json" };
	if (endpoint.auth === "session") {
		if (config.cookie) headers.Cookie = config.cookie;
		if (config.bearer) headers.Authorization = `Bearer ${config.bearer}`;
	}
	if (endpoint.auth === "cron" && config.bearer) {
		headers.Authorization = `Bearer ${config.bearer}`;
	}
	return headers;
}

export async function requestOnce(config, endpoint) {
	const started = performance.now();
	let response;
	try {
		response = await fetch(`${config.baseUrl}${endpoint.path}`, {
			method: endpoint.method,
			headers: authHeaders(config, endpoint),
			redirect: "manual",
			signal: AbortSignal.timeout(30_000),
		});
		const body = await response.arrayBuffer();
		return {
			status: response.status,
			ok: response.ok,
			headers: response.headers,
			body,
			elapsedMs: performance.now() - started,
			error: null,
		};
	} catch (error) {
		return {
			status: 0,
			ok: false,
			headers: new Headers(),
			body: new ArrayBuffer(0),
			elapsedMs: performance.now() - started,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function decodeJson(body) {
	try {
		return JSON.parse(Buffer.from(body).toString("utf8"));
	} catch {
		return null;
	}
}

export function parseServerTiming(header) {
	const metrics = {};
	if (!header) return metrics;
	for (const part of header.split(",")) {
		const [rawName, ...params] = part.split(";");
		const name = rawName.trim();
		if (!name) continue;
		for (const param of params) {
			const [rawKey, rawValue] = param.split("=");
			const key = rawKey.trim();
			const value = (rawValue ?? "").trim().replace(/^"|"$/g, "");
			if (key === "dur") metrics[name] = Number(value);
			else if (key === "desc" && !(name in metrics)) metrics[name] = value;
		}
	}
	return metrics;
}

/** Nearest-rank percentile. */
export function percentile(values, p) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function summarize(timings) {
	return {
		count: timings.length,
		p50: round(percentile(timings, 50)),
		p95: round(percentile(timings, 95)),
		p99: round(percentile(timings, 99)),
		max: round(Math.max(...timings)),
		min: round(Math.min(...timings)),
	};
}

export function round(value) {
	return Math.round(value * 10) / 10;
}

export function coverage(measured, skipped, total) {
	return total === 0 ? 0 : measured / total;
}

export function printCoverage(label, measured, skipped, total) {
	const pct = total === 0 ? 0 : (measured / total) * 100;
	console.log(
		`${label}: measured ${measured} / skipped ${skipped} / total ${total} (${pct.toFixed(1)}%)`,
	);
}

export function printServerTiming(metrics) {
	const parts = [];
	if (metrics.total !== undefined) parts.push(`total=${metrics.total}ms`);
	if (metrics.db !== undefined) parts.push(`db=${metrics.db}ms`);
	if (metrics.db_sum !== undefined) parts.push(`db_sum=${metrics.db_sum}ms`);
	if (metrics.app !== undefined) parts.push(`app=${metrics.app}ms`);
	if (metrics.auth !== undefined) parts.push(`auth=${metrics.auth}ms`);
	if (metrics.queries !== undefined) parts.push(`queries=${metrics.queries}`);
	return parts.join(" ");
}

export function toMarkdownTable(rows) {
	const header = "| Endpoint | Status | p50 | p95 | p99 | max | Server-Timing |";
	const divider = "|---|---|---|---|---|---|---|";
	const body = rows.map(
		(row) =>
			`| \`${row.endpoint}\` | ${row.status} | ${row.p50 ?? "-"} | ${row.p95 ?? "-"} | ${row.p99 ?? "-"} | ${row.max ?? "-"} | \`${row.serverTiming ?? "-"}\` |`,
	);
	return [header, divider, ...body].join("\n");
}

function toInt(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
