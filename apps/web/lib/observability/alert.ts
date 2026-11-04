import { createHash } from "node:crypto";
import { type ErrorSeverity, scrubContext, scrubText } from "@/lib/error-scrub";

/**
 * Provider-agnostic alert delivery (#729).
 *
 * ## Why this is not a vendor integration
 * The owner decided on an external pager with an SLO, but the provider and its
 * credential do not exist yet. This module therefore speaks one neutral
 * contract and nothing else:
 *
 *   POST $ALERT_WEBHOOK_URL
 *   content-type: application/json
 *   {
 *     "text":    "[OptiFeed][CRITICAL][production] cron/crop-watch: …",
 *     "content": "<the same one-line string>",
 *     "alert": {
 *       "version": 1,
 *       "severity": "CRITICAL",
 *       "fingerprint": "<stable sha256 or cron:<job>:<state>>",
 *       "route": "cron/crop-watch",
 *       "message": "<scrubbed detail>",
 *       "context": { … } | null,
 *       "service": "optifeed-web",
 *       "environment": "production" | "preview" | "development" | "unknown",
 *       "timestamp": "<ISO-8601>",
 *       "runbook": "https://github.com/J-Akiru5/OptiFeed/blob/main/docs/runbook.md"
 *     }
 *   }
 *
 * `text` is what a Slack incoming webhook renders. `content` is the same string
 * under Discord's field name, so a Discord webhook is usable without a code
 * change. `alert` is the structured copy a real pager adapter (PagerDuty Events
 * API, Opsgenie, an n8n workflow, …) can map from. No provider is hardcoded and
 * no provider SDK is added.
 *
 * ## Failure policy
 * `sendAlert` never rejects and never throws into the caller. A missing URL is a
 * silent no-op after exactly one log line per process. A timeout, DNS failure,
 * non-2xx response or bad payload is logged by name/status only — never with the
 * webhook URL, because a webhook URL is itself a secret.
 *
 * ## Dedup is per process, not cluster-wide
 * The cooldown map is in memory. On Vercel that means one map per warm function
 * instance: it stops a hot loop inside an instance, but two instances (or a
 * cold start) can each page once for the same fingerprint. That is deliberate
 * and stated plainly rather than implying cluster-wide deduplication. The real
 * pager should own acknowledgment and cross-instance dedupe.
 *
 * Window: `ALERT_COOLDOWN_MS`, default 10 minutes, clamped to 1 minute – 24
 * hours. Timeout: `ALERT_TIMEOUT_MS`, default 3 seconds, clamped to 0.5 – 10
 * seconds, applied with `AbortSignal.timeout` so a slow webhook cannot hold a
 * request open.
 */

export type AlertSeverity = ErrorSeverity | "CRITICAL";

export const ALERT_WEBHOOK_ENV = "ALERT_WEBHOOK_URL";
export const ALERT_COOLDOWN_ENV = "ALERT_COOLDOWN_MS";
export const ALERT_TIMEOUT_ENV = "ALERT_TIMEOUT_MS";
export const ALERT_RUNBOOK_ENV = "ALERT_RUNBOOK_URL";

export const DEFAULT_ALERT_COOLDOWN_MS = 10 * 60 * 1_000;
export const MIN_ALERT_COOLDOWN_MS = 60 * 1_000;
export const MAX_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_ALERT_TIMEOUT_MS = 3_000;
export const MIN_ALERT_TIMEOUT_MS = 500;
export const MAX_ALERT_TIMEOUT_MS = 10_000;

export const MAX_ALERT_MESSAGE_LENGTH = 1_000;
export const MAX_TRACKED_FINGERPRINTS = 500;
export const ALERT_SERVICE = "optifeed-web";
export const DEFAULT_RUNBOOK_URL = "https://github.com/J-Akiru5/OptiFeed/blob/main/docs/runbook.md";

/** Severities that are allowed to leave the process. ERROR/WARNING/INFO stay in the log. */
export function shouldPage(severity: AlertSeverity | undefined): boolean {
	return severity === "CRITICAL";
}

/**
 * The database enum has no CRITICAL and this change adds no migration, so a
 * page-worthy error is stored as ERROR. The alert payload keeps the original
 * severity; only the persisted row is flattened.
 */
export function storageSeverity(severity: AlertSeverity | undefined): ErrorSeverity {
	if (severity === "CRITICAL") return "ERROR";
	return severity ?? "ERROR";
}

export interface AlertInput {
	severity: AlertSeverity;
	/** Stable identity for dedup; `reportError` passes the ErrorEvent fingerprint. */
	fingerprint: string;
	route: string;
	message: string;
	context?: Record<string, unknown> | null;
	/** Injectable clock for tests and deterministic probes. Defaults to `Date.now()`. */
	now?: number;
}

export interface AlertPayload {
	text: string;
	content: string;
	alert: {
		version: 1;
		severity: AlertSeverity;
		fingerprint: string;
		route: string;
		message: string;
		context: Record<string, unknown> | null;
		service: string;
		environment: string;
		timestamp: string;
		runbook: string;
	};
}

export type AlertOutcome = "sent" | "duplicate" | "disabled" | "skipped" | "failed";

const lastAttemptAt = new Map<string, number>();
let unconfiguredLogged = false;

/** Test-only: clear the per-process cooldown map and the one-time log latch. */
export function resetAlertStateForTests(): void {
	lastAttemptAt.clear();
	unconfiguredLogged = false;
}

function positiveInteger(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function cooldownMs(): number {
	return positiveInteger(
		ALERT_COOLDOWN_ENV,
		DEFAULT_ALERT_COOLDOWN_MS,
		MIN_ALERT_COOLDOWN_MS,
		MAX_ALERT_COOLDOWN_MS,
	);
}

function timeoutMs(): number {
	return positiveInteger(
		ALERT_TIMEOUT_ENV,
		DEFAULT_ALERT_TIMEOUT_MS,
		MIN_ALERT_TIMEOUT_MS,
		MAX_ALERT_TIMEOUT_MS,
	);
}

function alertEnvironment(): string {
	return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}

function runbookUrl(): string {
	const configured = process.env[ALERT_RUNBOOK_ENV]?.trim();
	return configured ? configured : DEFAULT_RUNBOOK_URL;
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function resolveFingerprint(fingerprint: string, route: string, message: string): string {
	const explicit = fingerprint.trim();
	if (explicit) return explicit;
	return createHash("sha256").update([route, message].join("\n")).digest("hex");
}

/**
 * Build the wire payload without touching the network. Exported so the contract
 * in the comment above is testable and cannot drift silently.
 */
export function buildAlertPayload(
	input: AlertInput,
	now: number = input.now ?? Date.now(),
	fingerprint: string = resolveFingerprint(
		input.fingerprint,
		input.route,
		truncate(scrubText(input.message), MAX_ALERT_MESSAGE_LENGTH),
	),
): AlertPayload {
	const message = truncate(scrubText(input.message), MAX_ALERT_MESSAGE_LENGTH);
	const route = scrubText(input.route);
	const environment = alertEnvironment();
	const text = `[OptiFeed][${input.severity}][${environment}] ${route}: ${message}`;

	return {
		text,
		// Discord calls the same field `content`. Sending both keeps the sender
		// provider-neutral; neither Slack nor Discord needs a special case.
		content: text,
		alert: {
			version: 1,
			severity: input.severity,
			fingerprint,
			route,
			message,
			context: scrubContext(input.context ?? undefined),
			service: ALERT_SERVICE,
			environment,
			timestamp: new Date(now).toISOString(),
			runbook: runbookUrl(),
		},
	};
}

/**
 * Remember an attempt and answer whether this fingerprint is inside its
 * cooldown. The map is bounded: expired entries are swept first, then the
 * oldest live entries are evicted so a fingerprint flood cannot grow it
 * without bound.
 */
function insideCooldown(fingerprint: string, now: number, windowMs: number): boolean {
	const previous = lastAttemptAt.get(fingerprint);
	if (previous !== undefined && now - previous < windowMs) return true;

	lastAttemptAt.delete(fingerprint);
	lastAttemptAt.set(fingerprint, now);

	if (lastAttemptAt.size > MAX_TRACKED_FINGERPRINTS) {
		for (const [key, attemptedAt] of lastAttemptAt) {
			if (now - attemptedAt >= windowMs) lastAttemptAt.delete(key);
		}
	}
	while (lastAttemptAt.size > MAX_TRACKED_FINGERPRINTS) {
		const oldest = lastAttemptAt.keys().next().value;
		if (oldest === undefined) break;
		lastAttemptAt.delete(oldest);
	}

	return false;
}

function logUnconfiguredOnce(): void {
	if (unconfiguredLogged) return;
	unconfiguredLogged = true;
	console.warn(
		`[alert] ${ALERT_WEBHOOK_ENV} is not set; external paging is disabled, the log line is the alert.`,
	);
}

/**
 * Deliver one alert. Never rejects, never throws and never logs the URL.
 *
 * The cooldown is recorded before the network call, so two concurrent
 * occurrences of the same fingerprint in one process cannot both page. A failed
 * delivery still consumes the window: that is what stops a dead webhook from
 * being retried on every request. The next scheduled check (the cron watcher or
 * the next occurrence after the window) is the retry.
 */
export async function sendAlert(input: AlertInput): Promise<AlertOutcome> {
	try {
		if (!shouldPage(input.severity)) return "skipped";

		const url = process.env[ALERT_WEBHOOK_ENV]?.trim();
		if (!url) {
			logUnconfiguredOnce();
			return "disabled";
		}

		const now = input.now ?? Date.now();
		const message = truncate(scrubText(input.message), MAX_ALERT_MESSAGE_LENGTH);
		const fingerprint = resolveFingerprint(input.fingerprint, input.route, message);

		if (insideCooldown(fingerprint, now, cooldownMs())) return "duplicate";

		const payload = buildAlertPayload(input, now, fingerprint);

		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(timeoutMs()),
			});
		} catch (error) {
			// Name only: a fetch error message may contain the webhook URL.
			console.error("[alert] delivery failed", {
				reason: error instanceof Error ? error.name : "unknown",
			});
			return "failed";
		}

		if (!response.ok) {
			// Status only: response bodies are provider-specific and may echo the
			// request. The URL is never part of this line.
			console.error("[alert] delivery rejected", { status: response.status });
			return "failed";
		}

		return "sent";
	} catch (error) {
		// Absolute backstop. An alerting bug must never break a request or a cron
		// job, so even an unexpected synchronous failure resolves quietly.
		console.error("[alert] sender failed", {
			reason: error instanceof Error ? error.name : "unknown",
		});
		return "failed";
	}
}
