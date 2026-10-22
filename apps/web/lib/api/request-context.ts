import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request metrics shared between the instrumentation layer
 * (`withApi`) and the data layer (`lib/prisma.ts`).
 *
 * Why AsyncLocalStorage: the API regulation (§8.2 rule 13) requires query
 * counting to happen at the driver/connection level, not by manually wrapping
 * individual calls. Prisma exposes every operation through a client extension
 * hook; this store carries the counters back to the request that caused them.
 */
export interface RequestMetrics {
	requestId: string;
	/** Route template, e.g. `GET /api/v1/user-role` — never the raw URL. */
	route: string;
	startedAt: number;
	dbMs: number;
	queryCount: number;
	/** Named durations for non-DB work that is worth isolating (e.g. auth). */
	phases: Record<string, number>;
}

const storage = new AsyncLocalStorage<RequestMetrics>();

export function runWithRequestMetrics<T>(metrics: RequestMetrics, fn: () => T): T {
	return storage.run(metrics, fn);
}

export function getRequestMetrics(): RequestMetrics | undefined {
	return storage.getStore();
}

/** Called by the Prisma query extension. No-ops outside an instrumented request. */
export function recordQuery(durationMs: number): void {
	const metrics = storage.getStore();
	if (!metrics) return;
	metrics.queryCount += 1;
	metrics.dbMs += durationMs;
}

/** Record a named phase (auth, cache, upstream) inside the current request. */
export function recordPhase(name: string, durationMs: number): void {
	const metrics = storage.getStore();
	if (!metrics) return;
	metrics.phases[name] = (metrics.phases[name] ?? 0) + durationMs;
}

export function currentRequestId(): string | undefined {
	return storage.getStore()?.requestId;
}

/**
 * Turn a concrete pathname into a low-cardinality route template so logs and
 * metrics do not explode on ids:
 *   /api/v1/students/ckxyz123/payments -> /api/v1/students/{id}/payments
 */
export function routeTemplate(pathname: string): string {
	const segments = pathname.split("/").filter(Boolean);
	const templated = segments.map((segment) => {
		if (isIdentifierSegment(segment)) return "{id}";
		return segment;
	});
	return `/${templated.join("/")}`;
}

function isIdentifierSegment(segment: string): boolean {
	// cuid/cuid2, uuid, ULID, and plain numeric ids.
	return (
		/^c[a-z0-9]{20,}$/i.test(segment) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment) ||
		/^[0-9A-HJKMNP-TV-Z]{26}$/.test(segment) ||
		/^\d+$/.test(segment)
	);
}
