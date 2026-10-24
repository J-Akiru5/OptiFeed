import { currentRequestId } from "./request-context";

export interface PageMeta {
	limit: number;
	next_cursor: string | null;
	has_more: boolean;
	total?: number;
}

export interface SuccessEnvelope<T> {
	data: T;
	meta: {
		request_id: string;
		page?: PageMeta;
		[key: string]: unknown;
	};
}

export interface ErrorEnvelope {
	error: {
		code: string;
		message: string;
		details?: unknown;
		request_id: string;
	};
}

export interface RespondOptions {
	status?: number;
	headers?: HeadersInit;
	/** Override the request id (tests, background jobs). */
	requestId?: string;
}

let fallbackCounter = 0;

export function newRequestId(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
		return cryptoApi.randomUUID();
	}
	fallbackCounter += 1;
	return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 10)}`;
}

export function requestIdOf(requestId?: string): string {
	return requestId ?? currentRequestId() ?? newRequestId();
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** 200/201/… with the §4.1 success envelope. */
export function ok<T>(
	data: T,
	options: RespondOptions & { meta?: Record<string, unknown> } = {},
): Response {
	const { status = 200, headers, requestId, meta } = options;
	const body: SuccessEnvelope<T> = {
		data,
		meta: { ...meta, request_id: requestIdOf(requestId) },
	};
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": JSON_CONTENT_TYPE,
			...toHeaderRecord(headers),
		},
	});
}

/** 201 Created with the required `Location` header (§5). */
export function created<T>(data: T, location: string, options: RespondOptions = {}): Response {
	return ok(data, {
		...options,
		status: 201,
		headers: { ...toHeaderRecord(options.headers), Location: location },
	});
}

/** 202 Accepted with a status URL — the response for queued background work (§8.2 rule 9). */
export function accepted<T>(data: T, location: string, options: RespondOptions = {}): Response {
	return ok(data, {
		...options,
		status: 202,
		headers: {
			...toHeaderRecord(options.headers),
			Location: location,
			"Cache-Control": "no-store",
		},
	});
}

/** 204 No Content — an empty body, never `{}` (§4.1). */
export function noContent(options: Omit<RespondOptions, "status"> = {}): Response {
	return new Response(null, {
		status: 204,
		headers: toHeaderRecord(options.headers),
	});
}

/** 4xx/5xx with the §4.2 error envelope. */
export function fail(error: Error, options: RespondOptions = {}): Response {
	const apiError = asApiError(error);
	const status = options.status ?? apiError.status;
	const message = apiError.expose ? apiError.message : "An unexpected error occurred.";
	const body: ErrorEnvelope = {
		error: {
			code: apiError.code,
			message,
			...(apiError.details !== undefined ? { details: apiError.details } : {}),
			request_id: requestIdOf(options.requestId),
		},
	};
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": JSON_CONTENT_TYPE,
			...toHeaderRecord(apiError.headers),
			...toHeaderRecord(options.headers),
		},
	});
}

/** List response with §4.1 pagination metadata. */
export function paginated<T>(items: T[], page: PageMeta, options: RespondOptions = {}): Response {
	return ok(items, { ...options, meta: { page } });
}

/**
 * Reference-data response with `ETag` + `Cache-Control` (§8.2 rule 8).
 * Honours `If-None-Match` and returns 304 with the same cache headers.
 */
export function cachedOk<T>(
	data: T,
	request: Request,
	options: RespondOptions & {
		maxAgeSeconds: number;
		private?: boolean;
		meta?: Record<string, unknown>;
	} = {
		maxAgeSeconds: 300,
	},
): Response {
	const {
		status = 200,
		headers,
		requestId,
		meta,
		maxAgeSeconds,
		private: isPrivate = false,
	} = options;
	const body: SuccessEnvelope<T> = {
		data,
		meta: { ...meta, request_id: requestIdOf(requestId) },
	};
	const serialized = JSON.stringify(body);
	// The ETag covers only the representation that changes: `request_id` is
	// per-request, so folding it into the hash would make every conditional
	// request miss and every 304 impossible.
	const etag = `"${fnv1a64(JSON.stringify({ data, meta }))}"`;
	const cacheHeaders: Record<string, string> = {
		ETag: etag,
		"Cache-Control": `${isPrivate ? "private" : "public"}, max-age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
		Vary: isPrivate ? "Cookie" : "Accept-Encoding",
		...toHeaderRecord(headers),
	};

	if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
		return new Response(null, { status: 304, headers: cacheHeaders });
	}

	return new Response(serialized, {
		status,
		headers: { "Content-Type": JSON_CONTENT_TYPE, ...cacheHeaders },
	});
}

function matchesIfNoneMatch(header: string | null, etag: string): boolean {
	if (!header) return false;
	return header
		.split(",")
		.map((part) => part.trim())
		.some((part) => part === etag || part === "*" || part === `W/${etag}`);
}

/** Stable 64-bit-style ETag from two 32-bit FNV-1a lanes. */
function fnv1a64(input: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		a = Math.imul(a ^ code, 0x01000193);
		b = Math.imul(b ^ code, 0x85ebca6b);
	}
	return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
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

function asApiError(error: Error): {
	status: number;
	code: string;
	message: string;
	details?: unknown;
	headers?: HeadersInit;
	expose: boolean;
} {
	// Avoid a runtime import cycle: errors.ts has no dependency on envelope.ts.
	const candidate = error as Error & {
		status?: unknown;
		code?: unknown;
		details?: unknown;
		headers?: HeadersInit;
		expose?: unknown;
	};
	if (
		typeof candidate.status === "number" &&
		typeof candidate.code === "string" &&
		typeof candidate.expose === "boolean"
	) {
		return {
			status: candidate.status,
			code: candidate.code,
			message: candidate.message,
			details: candidate.details,
			headers: candidate.headers,
			expose: candidate.expose,
		};
	}
	return {
		status: 500,
		code: "INTERNAL_ERROR",
		message: "An unexpected error occurred.",
		expose: false,
	};
}
