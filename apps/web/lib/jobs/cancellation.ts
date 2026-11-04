/**
 * Cooperative cancellation for background jobs (#728).
 *
 * Neither `Promise.race` in `withApi`/`withTimeLimit` nor Prisma's query API
 * can cancel in-flight work by itself. Builders therefore check an
 * `AbortSignal` at each step boundary: a route that already returned 504, or a
 * job that exceeded its wall clock, stops before the next query/artifact
 * instead of continuing to consume DB and function time.
 */
export class JobCancelledError extends Error {
	constructor(message = "The job was cancelled.") {
		super(message);
		this.name = "JobCancelledError";
	}
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new JobCancelledError();
}

/** Combine a request signal with a job-local timeout controller. */
export function jobSignal(
	requestSignal: AbortSignal | undefined,
	controller: AbortController,
): AbortSignal {
	return requestSignal ? AbortSignal.any([requestSignal, controller.signal]) : controller.signal;
}
