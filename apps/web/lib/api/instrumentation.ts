import { fail, newRequestId } from "./envelope";
import { ApiError, type ApiErrorCode, codeForStatus, toApiError } from "./errors";
import { type RequestMetrics, routeTemplate, runWithRequestMetrics } from "./request-context";

/** A route handler, before instrumentation. */
type ApiHandler<R extends Request, C> = (request: R, context: C) => Promise<Response> | Response;

export interface ApiRouteConfig {
	/** Stable route template for logs. Defaults to `METHOD /path/{id}`. */
	route?: string;
	/**
	 * `envelope` (default): normalize 4xx/5xx bodies to the §4.2 error envelope.
	 * `passthrough`: leave bodies untouched (firmware, file downloads, SSE).
	 */
	shape?: "envelope" | "passthrough";
	/**
	 * Absolute request budget (§8.1). `0` disables the guard. Default 2000 ms.
	 * Bulk imports opt out with a documented value while they wait for a
	 * background-job rewrite.
	 */
	timeoutMs?: number;
	/** Sets `Deprecation` + `Sunset` on a legacy, dual-served path (§3.1). */
	sunset?: string;
	/** Default cache policy. Handlers may set a stronger one themselves. */
	cacheControl?: string;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const SLOW_MS = 300;
const VIOLATION_MS = 400;
const N_PLUS_ONE_THRESHOLD = 5;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Wrap a route handler with the §9 request pipeline:
 *
 *  - `X-Request-Id` on every response (generated or accepted from the client)
 *  - `Server-Timing: total, db, app, auth, queries` on every response,
 *    including 4xx/5xx and thrown exceptions
 *  - `WARN SLOW` (>300 ms) / `ERROR VIOLATION` (>400 ms) logs with the route
 *    template, query count, and DB time
 *  - an absolute timeout that returns `504 TIMEOUT`
 *  - error-envelope normalization for browser-facing routes
 *
 * The wrapper belongs to the request pipeline, not individual handlers, and
 * it wraps the auth/error layers (compose it outermost).
 */
export function withApi<R extends Request = Request, C = unknown>(
	handler: ApiHandler<R, C>,
	config: ApiRouteConfig = {},
): (request: R, context?: C) => Promise<Response> {
	const shape = config.shape ?? "envelope";
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return async (request: R, context?: C): Promise<Response> => {
		const startedAt = now();
		const requestId = resolveRequestId(request);
		const route = config.route ?? defaultRoute(request);

		const metrics: RequestMetrics = {
			requestId,
			route,
			startedAt,
			dbMs: 0,
			queryCount: 0,
			phases: {},
		};

		let response: Response;
		try {
			response = await runWithRequestMetrics(metrics, () =>
				runWithTimeout(handler, request, context as C, timeoutMs, requestId),
			);
		} catch (error) {
			const apiError = toApiError(error);
			// The VIOLATION log below already records a timeout; a second stack
			// trace for the same expected outcome is noise.
			if (!(apiError instanceof ApiError && apiError.status === 504)) {
				logFailure(error, metrics);
			}
			response =
				shape === "passthrough" && apiError.status === 504
					? new Response("Gateway Timeout", { status: 504 })
					: fail(apiError, { requestId });
		}

		if (shape === "envelope" && response.status >= 400) {
			response = await normalizeErrorResponse(response, requestId);
		}

		return finalize(response, metrics, config);
	};
}

async function runWithTimeout<R extends Request, C>(
	handler: ApiHandler<R, C>,
	request: R,
	context: C,
	timeoutMs: number,
	requestId: string,
): Promise<Response> {
	const work = Promise.resolve().then(() => handler(request, context));
	if (timeoutMs <= 0) return work;

	// The timeout rejects the race; keep the underlying promise observed so a
	// late failure never becomes an unhandled rejection. The outer catch owns
	// error logging, which avoids double-reporting the same failure.
	work.catch(() => {});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Response>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new ApiError(504, "TIMEOUT", "The request exceeded its 2,000 ms budget.", {
					headers: { "X-Request-Id": requestId },
					expose: true,
				}),
			);
		}, timeoutMs);
		(timer as { unref?: () => void }).unref?.();
	});

	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function normalizeErrorResponse(response: Response, requestId: string): Promise<Response> {
	// Read a clone: a conformant response is returned untouched, and consuming
	// its body here would make it unusable for the client. A body that is
	// already locked (streaming) cannot be normalized; return it as-is.
	let working: Response;
	try {
		working = response.clone();
	} catch {
		return response;
	}
	const contentType = working.headers.get("content-type") ?? "";

	let message = response.statusText || "The request failed.";
	let code = codeForStatus(response.status);
	let details: unknown;

	if (contentType.includes("application/json")) {
		const body = (await working.json().catch(() => null)) as {
			error?: unknown;
			message?: unknown;
			code?: unknown;
			details?: unknown;
		} | null;
		if (body) {
			if (typeof body.error === "string") {
				message = body.error;
			} else if (body.error && typeof body.error === "object") {
				const nested = body.error as {
					code?: unknown;
					message?: unknown;
					details?: unknown;
					request_id?: unknown;
				};
				if (typeof nested.message === "string") message = nested.message;
				if (typeof nested.code === "string") code = nested.code as ApiError["code"];
				if (nested.details !== undefined) details = nested.details;
				if (typeof nested.request_id === "string" && nested.request_id === requestId) {
					// Already conformant: only the instrumentation headers are missing.
					return response;
				}
			} else if (typeof body.message === "string") {
				message = body.message;
			} else if (typeof body.code === "string") {
				code = body.code as ApiError["code"];
			}
			if (body.details !== undefined) details = body.details;
		}
	} else if (contentType.includes("text/plain")) {
		const text = (await working.text().catch(() => "")).trim();
		if (text) message = text;
	}

	const safeMessage =
		response.status >= 500 && !contentType.includes("json")
			? "An unexpected error occurred."
			: message;

	const headers = new Headers(response.headers);
	headers.delete("content-type");
	headers.delete("content-length");

	return fail(
		new ApiError(response.status, code, truncate(safeMessage, 500), {
			details,
			headers: {},
			expose: true,
		}),
		{ headers, requestId },
	);
}

function finalize(response: Response, metrics: RequestMetrics, config: ApiRouteConfig): Response {
	const totalMs = now() - metrics.startedAt;
	const dbMs = metrics.dbMs;
	const authMs = metrics.phases.auth ?? 0;
	const appMs = Math.max(0, totalMs - dbMs - authMs);

	setHeader(response, "X-Request-Id", metrics.requestId);
	setHeader(response, "Server-Timing", serverTiming({ totalMs, dbMs, appMs, authMs, metrics }));
	if (config.cacheControl) setHeader(response, "Cache-Control", config.cacheControl);
	if (config.sunset) {
		setHeader(response, "Deprecation", "true");
		setHeader(response, "Sunset", toHttpDate(config.sunset));
	}

	const logLine = {
		route: metrics.route,
		method: metrics.route.split(" ")[0],
		status: response.status,
		duration_ms: round(totalMs),
		db_ms: round(dbMs),
		app_ms: round(appMs),
		auth_ms: round(authMs),
		queries: metrics.queryCount,
		request_id: metrics.requestId,
	};

	if (totalMs > VIOLATION_MS) {
		console.error("[api] ERROR VIOLATION", logLine);
	} else if (totalMs > SLOW_MS) {
		console.warn("[api] WARN SLOW", logLine);
	}

	if (metrics.queryCount > N_PLUS_ONE_THRESHOLD) {
		console.warn("[api] WARN N+1", logLine);
	}

	// Passthrough routes still get headers, but their bodies stay untouched.
	return response;
}

function serverTiming(input: {
	totalMs: number;
	dbMs: number;
	appMs: number;
	authMs: number;
	metrics: RequestMetrics;
}): string {
	const parts = [
		`total;dur=${round(input.totalMs)}`,
		`db;dur=${round(input.dbMs)}`,
		`app;dur=${round(input.appMs)}`,
	];
	if (input.authMs > 0) parts.push(`auth;dur=${round(input.authMs)}`);
	parts.push(`queries;desc=${input.metrics.queryCount}`);
	return parts.join(", ");
}

function setHeader(response: Response, name: string, value: string): void {
	try {
		response.headers.set(name, value);
	} catch {
		// Immutable headers (e.g. a proxied upstream response) must not break
		// the response. The regulation's headers are applied at the edge by the
		// framework in that case.
	}
}

function resolveRequestId(request: Request): string {
	const supplied = request.headers.get("x-request-id");
	if (supplied && REQUEST_ID_PATTERN.test(supplied)) return supplied;
	return newRequestId();
}

function defaultRoute(request: Request): string {
	const url = new URL(request.url);
	return `${request.method.toUpperCase()} ${routeTemplate(url.pathname)}`;
}

function toHttpDate(date: string): string {
	const parsed = new Date(`${date}T23:59:59Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return parsed.toUTCString();
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function now(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logFailure(error: unknown, metrics: RequestMetrics | undefined): void {
	if (!metrics) {
		console.error("[api] unhandled route error", error);
		return;
	}
	console.error("[api] route error", {
		route: metrics.route,
		request_id: metrics.requestId,
		error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
	});
}
