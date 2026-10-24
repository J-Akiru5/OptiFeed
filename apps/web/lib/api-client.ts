/**
 * The single browser API client (§8.3 rule 1).
 *
 * Every dashboard call goes through this module so base handling, auth
 * cookies, envelope unwrapping, error mapping, timeouts, and retries live in
 * one place. Do not call `fetch("/api/...")` directly in components, except
 * for streaming (SSE) and file downloads, which use `rawFetch`.
 */

export interface ApiClientErrorShape {
	status: number;
	code: string;
	message: string;
	details?: unknown;
	requestId: string | null;
}

export class ApiClientError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;
	readonly requestId: string | null;

	constructor(shape: ApiClientErrorShape) {
		super(shape.message);
		this.name = "ApiClientError";
		this.status = shape.status;
		this.code = shape.code;
		this.details = shape.details;
		this.requestId = shape.requestId;
	}
}

/** Regulation §8.3 rule 2: reads abort after 1 000 ms. */
export const READ_TIMEOUT_MS = 1_000;
/** Writes get an explicit, longer budget. */
export const WRITE_TIMEOUT_MS = 10_000;

interface RequestOptions {
	/** Override the timeout. Streaming and file transfers must opt in. */
	timeoutMs?: number;
	/** Retries only apply to GET, or to writes carrying an Idempotency-Key. */
	retries?: number;
	idempotencyKey?: string;
	signal?: AbortSignal;
	headers?: HeadersInit;
	/** Skip envelope unwrapping and return the raw response (files, SSE). */
	raw?: boolean;
}

export function apiGet<T>(path: string, options: Omit<RequestOptions, "raw"> = {}): Promise<T> {
	return request<T>(
		path,
		{ method: "GET" },
		{ ...options, timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS },
	);
}

export function apiPost<T>(
	path: string,
	body?: unknown,
	options: Omit<RequestOptions, "raw"> = {},
): Promise<T> {
	return request<T>(
		path,
		{
			method: "POST",
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			...(options.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
		},
		{ ...options, timeoutMs: options.timeoutMs ?? WRITE_TIMEOUT_MS },
	);
}

/** For SSE and file downloads: no JSON parsing, no envelope unwrapping. */
export function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(path, { ...init, credentials: "same-origin" });
}

async function request<T>(path: string, init: RequestInit, options: RequestOptions): Promise<T> {
	const attempts = allowedAttempts(init, options);
	let lastError: unknown;

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await once<T>(path, init, options);
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted) break;
			if (!isRetryable(error) || attempt === attempts - 1) break;
			await sleep(100 * 2 ** attempt);
		}
	}

	throw lastError;
}

async function once<T>(path: string, init: RequestInit, options: RequestOptions): Promise<T> {
	const controller = new AbortController();
	const timeoutMs = options.timeoutMs ?? WRITE_TIMEOUT_MS;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const abortFromCaller = () => controller.abort();
	options.signal?.addEventListener("abort", abortFromCaller, { once: true });

	try {
		const response = await fetch(path, {
			...init,
			credentials: "same-origin",
			headers: {
				Accept: options.raw ? "*/*" : "application/json",
				...(isJsonBody(init) ? { "Content-Type": "application/json" } : {}),
				...toHeaderRecord(options.headers),
			},
			signal: controller.signal,
		});

		if (options.raw) return response as T;

		if (!response.ok) throw await toApiClientError(response);

		if (response.status === 204) return undefined as T;

		const envelope = (await response.json()) as { data?: T };
		return (envelope.data ?? (envelope as T)) as T;
	} catch (error) {
		if (error instanceof ApiClientError) throw error;
		if (isAbortError(error)) {
			// A caller abort is deliberate (range/filter change, unmount). It
			// must not be retried as if it were a slow server.
			if (options.signal?.aborted) {
				throw new ApiClientError({
					status: 0,
					code: "CLIENT_ABORTED",
					message: "Request cancelled.",
					requestId: null,
				});
			}
			throw new ApiClientError({
				status: 0,
				code: "CLIENT_TIMEOUT",
				message: "The server took too long to respond. Try again.",
				requestId: null,
			});
		}
		throw new ApiClientError({
			status: 0,
			code: "NETWORK_ERROR",
			message: "Could not reach the server. Check your connection and try again.",
			requestId: null,
		});
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
	const requestId = response.headers.get("x-request-id");
	let code = `HTTP_${response.status}`;
	let message = response.statusText || "The request failed.";
	let details: unknown;

	try {
		const body = (await response.json()) as {
			error?: { code?: string; message?: string; details?: unknown } | string;
		};
		if (typeof body.error === "string") {
			message = body.error;
		} else if (body.error) {
			code = body.error.code ?? code;
			message = body.error.message ?? message;
			details = body.error.details;
		}
	} catch {
		// Non-JSON error body: keep the status text.
	}

	return new ApiClientError({ status: response.status, code, message, details, requestId });
}

function allowedAttempts(init: RequestInit, options: RequestOptions): number {
	const method = (init.method ?? "GET").toUpperCase();
	const safeToRetry = method === "GET" || Boolean(options.idempotencyKey);
	const configured = options.retries ?? (method === "GET" ? 2 : 0);
	return safeToRetry ? Math.min(configured, 2) + 1 : 1;
}

function isRetryable(error: unknown): boolean {
	if (!(error instanceof ApiClientError)) return false;
	if (error.code === "CLIENT_ABORTED") return false;
	if (error.code === "CLIENT_TIMEOUT" || error.code === "NETWORK_ERROR") return true;
	return error.status === 429 || error.status >= 500;
}

function isAbortError(error: unknown): boolean {
	return (
		(typeof error === "object" &&
			error !== null &&
			"name" in error &&
			(error as { name?: string }).name === "AbortError") ||
		(error instanceof DOMException && error.name === "AbortError")
	);
}

function isJsonBody(init: RequestInit): boolean {
	return typeof init.body === "string";
}

function toHeaderRecord(headers?: HeadersInit): Record<string, string> {
	if (!headers) return {};
	if (headers instanceof Headers) {
		const record: Record<string, string> = {};
		headers.forEach((value, key) => {
			record[key] = value;
		});
		return record;
	}
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...headers };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
