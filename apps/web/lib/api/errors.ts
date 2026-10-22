/**
 * Error taxonomy for the API regulation (§4.2, §5).
 *
 * `code` is the stable, machine-readable contract. `message` is safe to show
 * to a user and must never contain a stack trace, SQL, file path, or secret.
 */
export const API_ERROR_CODES = {
	BAD_REQUEST: 400,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	METHOD_NOT_ALLOWED: 405,
	CONFLICT: 409,
	PAYLOAD_TOO_LARGE: 413,
	UNSUPPORTED_MEDIA_TYPE: 415,
	VALIDATION_FAILED: 422,
	RATE_LIMITED: 429,
	INTERNAL_ERROR: 500,
	UPSTREAM_ERROR: 502,
	UNAVAILABLE: 503,
	TIMEOUT: 504,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

/**
 * Field-level information for a validation error. Intentionally open: the
 * regulation allows an array of `{ field, issue }` objects or a free-form
 * object, and the envelope must not constrain the caller's shape.
 */
export type ApiErrorDetails = unknown;

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
	400: "BAD_REQUEST",
	401: "UNAUTHENTICATED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	405: "METHOD_NOT_ALLOWED",
	409: "CONFLICT",
	413: "PAYLOAD_TOO_LARGE",
	415: "UNSUPPORTED_MEDIA_TYPE",
	422: "VALIDATION_FAILED",
	429: "RATE_LIMITED",
	500: "INTERNAL_ERROR",
	502: "UPSTREAM_ERROR",
	503: "UNAVAILABLE",
	504: "TIMEOUT",
};

export function codeForStatus(status: number): ApiErrorCode {
	return STATUS_TO_CODE[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
}

/**
 * An error that is safe to serialize to a client.
 *
 * `expose` is false for unexpected failures: the public message is then
 * replaced by a generic one while the original error is still logged.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	readonly details?: ApiErrorDetails;
	readonly headers?: HeadersInit;
	readonly expose: boolean;

	constructor(
		status: number,
		code: ApiErrorCode,
		message: string,
		options: {
			details?: ApiErrorDetails;
			headers?: HeadersInit;
			expose?: boolean;
			cause?: unknown;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = options.details;
		this.headers = options.headers;
		this.expose = options.expose ?? status < 500;
	}
}

export function badRequest(message: string, details?: ApiErrorDetails): ApiError {
	return new ApiError(400, "BAD_REQUEST", message, { details });
}

export function unauthorized(message = "Authentication is required."): ApiError {
	return new ApiError(401, "UNAUTHENTICATED", message);
}

export function forbidden(
	message = "You do not have permission to perform this action.",
): ApiError {
	return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "The requested resource was not found."): ApiError {
	return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message: string, details?: ApiErrorDetails): ApiError {
	return new ApiError(409, "CONFLICT", message, { details });
}

export function validationFailed(message: string, details?: ApiErrorDetails): ApiError {
	return new ApiError(422, "VALIDATION_FAILED", message, { details });
}

export function rateLimited(
	message = "Too many requests. Try again shortly.",
	retryAfterSeconds = 60,
): ApiError {
	return new ApiError(429, "RATE_LIMITED", message, {
		headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
	});
}

export function timeout(message = "The request exceeded its time budget."): ApiError {
	return new ApiError(504, "TIMEOUT", message);
}

/**
 * Map any thrown value to a safe HTTP error.
 *
 * Unknown errors become a generic 500: their details are logged by the caller
 * and never serialized (§4.2).
 */
export function toApiError(error: unknown): ApiError {
	if (error instanceof ApiError) return error;

	// Zod v4: `issues` array. Duck-typed so this module stays framework-agnostic.
	if (isZodError(error)) {
		return new ApiError(422, "VALIDATION_FAILED", "The request contains invalid values.", {
			details: error.issues.map((issue) => ({
				field: issue.path.join("."),
				issue: issue.message,
			})),
		});
	}

	const prismaCode = readPrismaCode(error);
	if (prismaCode === "P2002") {
		return new ApiError(409, "CONFLICT", "That record already exists.");
	}
	if (prismaCode === "P2025") {
		return new ApiError(404, "NOT_FOUND", "The requested resource was not found.");
	}

	return new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.", {
		expose: false,
		cause: error,
	});
}

function isZodError(
	error: unknown,
): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
	return (
		typeof error === "object" &&
		error !== null &&
		"issues" in error &&
		Array.isArray((error as { issues?: unknown }).issues)
	);
}

function readPrismaCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const name = (error as { name?: unknown }).name;
	const code = (error as { code?: unknown }).code;
	if (typeof name === "string" && name.includes("Prisma") && typeof code === "string") return code;
	return undefined;
}
