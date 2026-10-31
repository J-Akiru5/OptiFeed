import { createHash } from "node:crypto";
import { type ErrorSeverity, errorDetails, scrubContext, scrubText } from "@/lib/error-scrub";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * First-party error capture — persistence, dedupe and retention (I-64).
 *
 * Owner decision E1: no external error service. `reportError()` in
 * lib/observability.ts calls `buildErrorEvent()` then `persistErrorEvent()`;
 * this module never lets a capture problem escape into the request path.
 *
 * ## Dedupe
 * `fingerprint` is a sha256 of severity, route, the scrubbed message and the
 * first stack frame (with line/column stripped and long numbers parameterised).
 * A repeat occurrence upserts: `count` increments and `lastSeenAt` moves. A
 * resolved row is reopened, because an error that recurs is not fixed.
 *
 * ## Scrubbing
 * Everything written passes through lib/error-scrub.ts first. Message, stack
 * and route are scrubbed as text; context is scrubbed recursively, and a
 * sensitive key (`token`, `password`, `email`, …) redacts its whole value.
 *
 * ## Retention
 * `ERROR_EVENT_RETENTION_DAYS` (30) days after `lastSeenAt`, a row is eligible
 * for deletion. `deleteExpiredErrorEvents()` deletes one bounded batch per run
 * so the table cannot grow unbounded and the cron route stays inside its
 * execution budget. It is wired into the every-5-minutes device-watch cron
 * (app/api/cron/device-watch/route.ts), which already does batched housekeeping.
 */

export const ERROR_EVENT_RETENTION_DAYS = 30;
export const ERROR_EVENT_CLEANUP_BATCH = 500;
export const MAX_ERROR_MESSAGE_LENGTH = 1_000;
export const MAX_ERROR_STACK_LENGTH = 8_000;
export const MAX_ERROR_ROUTE_LENGTH = 200;

export interface ErrorEventRecord {
	fingerprint: string;
	message: string;
	stack: string | null;
	route: string;
	severity: ErrorSeverity;
	context: Record<string, unknown> | null;
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Route label for the admin list: explicit `route`, else the caller's `action`. */
function resolveRoute(context?: Record<string, unknown>): string {
	const raw = context?.route ?? context?.action;
	const text = typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
	const scrubbed = scrubText(text.trim());
	return truncate(scrubbed, MAX_ERROR_ROUTE_LENGTH) || "unknown";
}

/** First stack frame, without line/column numbers so code shifts do not fork rows. */
function topStackFrame(stack: string | null): string {
	if (!stack) return "";
	const line = stack.split("\n").find((entry) => /^\s*at /.test(entry));
	if (!line) return "";
	return line
		.trim()
		.replace(/:\d+:\d+(\)?)$/, "$1")
		.replace(/:\d+(\)?)$/, "$1")
		.slice(0, 300);
}

/**
 * Collapse run-specific values so the same failure keeps one row.
 * E-mail addresses and tokens are already gone by the time this runs.
 */
function normalizeForFingerprint(message: string): string {
	return message
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ":uuid")
		.replace(/\b\d{4,}\b/g, ":n")
		.slice(0, 300);
}

/** Stable dedupe key for one error identity. */
export function fingerprintError(
	message: string,
	stack: string | null,
	route: string,
	severity: ErrorSeverity,
): string {
	return createHash("sha256")
		.update([severity, route, normalizeForFingerprint(message), topStackFrame(stack)].join("\n"))
		.digest("hex");
}

/** Turn anything thrown into the scrubbed row we are allowed to persist. */
export function buildErrorEvent(
	error: unknown,
	context?: Record<string, unknown>,
	severity: ErrorSeverity = "ERROR",
): ErrorEventRecord {
	const details = errorDetails(error);
	const message = truncate(scrubText(details.message), MAX_ERROR_MESSAGE_LENGTH);
	const stack = details.stack ? truncate(scrubText(details.stack), MAX_ERROR_STACK_LENGTH) : null;
	const route = resolveRoute(context);
	const scrubbedContext = scrubContext(context);

	return {
		fingerprint: fingerprintError(message, stack, route, severity),
		message,
		stack,
		route,
		severity,
		context: scrubbedContext,
	};
}

function isUniqueViolation(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Scrubbed diagnostics for a failed write, so the fallback log cannot leak either. */
function describeFailure(failure: unknown): Record<string, unknown> {
	if (failure instanceof Error) {
		return {
			name: failure.name,
			message: scrubText(failure.message),
			stack: failure.stack ? scrubText(failure.stack) : null,
		};
	}
	return { message: scrubText(String(failure)), stack: null };
}

function mutationData(record: ErrorEventRecord) {
	return {
		message: record.message,
		stack: record.stack,
		route: record.route,
		severity: record.severity,
		context:
			record.context === null
				? Prisma.DbNull
				: (record.context as unknown as Prisma.InputJsonValue),
	};
}

/**
 * Upsert one captured error.
 *
 * Never rejects: a database outage, a missing table (fresh environment before
 * the migration) or a unique race falls back to `console.error`. That is the
 * point of the module — error reporting must not be able to break the request
 * that was already failing.
 */
export async function persistErrorEvent(record: ErrorEventRecord): Promise<void> {
	const now = new Date();
	const data = mutationData(record);
	const update = {
		...data,
		lastSeenAt: now,
		count: { increment: 1 },
		// Recurrence reopens a resolved row: an error that comes back is not fixed.
		resolved: false,
		resolvedAt: null,
		resolvedBy: null,
	};

	try {
		await prisma.errorEvent.upsert({
			where: { fingerprint: record.fingerprint },
			create: {
				fingerprint: record.fingerprint,
				...data,
				firstSeenAt: now,
				lastSeenAt: now,
				count: 1,
				resolved: false,
			},
			update,
		});
	} catch (error) {
		// Two concurrent first occurrences can race past the upsert's own
		// insert. The row exists now, so the correct outcome is an update.
		if (!isUniqueViolation(error)) {
			console.error("[obs] failed to persist error event", describeFailure(error));
			return;
		}
		try {
			await prisma.errorEvent.update({
				where: { fingerprint: record.fingerprint },
				data: update,
			});
		} catch (retryError) {
			console.error("[obs] failed to persist error event", describeFailure(retryError));
		}
	}
}

/**
 * Delete one bounded batch of rows whose last occurrence is older than the
 * retention window. Called by the device-watch cron; safe to re-run.
 */
export async function deleteExpiredErrorEvents(
	batchSize = ERROR_EVENT_CLEANUP_BATCH,
): Promise<number> {
	const take = Math.max(1, Math.min(batchSize, 5_000));
	const cutoff = new Date(Date.now() - ERROR_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);

	const stale = await prisma.errorEvent.findMany({
		where: { lastSeenAt: { lt: cutoff } },
		select: { id: true },
		orderBy: { lastSeenAt: "asc" },
		take,
	});

	if (stale.length === 0) return 0;

	// The lastSeenAt index makes the range scan cheap; the id batch keeps the
	// delete short enough for the cron budget.
	const result = await prisma.errorEvent.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});
	return result.count;
}
