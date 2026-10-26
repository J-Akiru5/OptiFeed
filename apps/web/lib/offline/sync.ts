import { saveBiomassLog } from "@/lib/actions/biomass";
import { isBrowserOnline } from "@/lib/pwa/feed-safety";
import {
	type OutboxItem,
	type StoredOutboxRecord,
	isBiomassOutboxItem,
	listOutbox,
	listOutboxRecords,
	looksLikeFeedCommand,
	markOutboxAttempt,
	markOutboxConflict,
	removeOutboxItem,
} from "./outbox";

export interface OutboxFailure {
	id: string;
	createdAt: string;
	error: string;
	status: "failed" | "conflict";
	attempts: number;
}

export interface FlushOutboxResult {
	synced: number;
	remaining: number;
	errors: string[];
	failures: OutboxFailure[];
	/** Feed/lookalike records purged from an old queue instead of being sent. */
	discardedFeed: number;
	/** True when another replay (this tab or another tab) was already running. */
	busy: boolean;
}

const REPLAY_LOCK = "optifeed-outbox-replay";
const MAX_ATTEMPTS = 3;

/** Same-tab guard for browsers without the Web Locks API. */
let replaying = false;

const SESSION_ERROR = /session|unauth|login|sign in|jwt|token|not authenticated/i;
const CONFLICT_ERROR =
	/not found|invalid|validation|could not be read|out of range|exceeds|must be|already saved|duplicate conflict/i;

type FailureKind = "session" | "conflict" | "retry";

function classifyFailure(message: string): FailureKind {
	if (SESSION_ERROR.test(message)) return "session";
	if (CONFLICT_ERROR.test(message)) return "conflict";
	return "retry";
}

function buildFormData(item: OutboxItem): FormData {
	const payload = item.payload;
	const formData = new FormData();
	// clientEventId is the server-side exactly-once key (BiomassLog id).
	formData.append("clientEventId", payload.clientEventId);
	formData.append("idempotencyKey", item.idempotencyKey ?? payload.clientEventId);
	formData.append("pondId", payload.pondId);
	formData.append("sampleWeightKg", String(payload.sampleWeightKg));
	formData.append("sampleLengthCm", String(payload.sampleLengthCm));
	formData.append("sampleCount", String(payload.sampleCount));
	formData.append("batchLabel", payload.batchLabel ?? "");
	formData.append("recordedAt", payload.recordedAt);
	if (payload.fishSamples && payload.fishSamples.length > 0) {
		formData.append("fishSamples", JSON.stringify(payload.fishSamples));
	}
	return formData;
}

async function failuresForScope(scope: string): Promise<OutboxFailure[]> {
	return (await listOutbox())
		.filter(
			(item) =>
				item.payload.scope === scope && (item.status === "failed" || item.status === "conflict"),
		)
		.map((item) => ({
			id: item.id,
			createdAt: item.createdAt,
			error: item.lastError ?? "Sync failed",
			status: item.status as "failed" | "conflict",
			attempts: item.attempts,
		}));
}

async function remainingForScope(scope: string): Promise<number> {
	return (await listOutbox()).filter((item) => item.payload.scope === scope).length;
}

/**
 * Feeding safety: anything that is not a biomass sample is removed from the
 * queue. Old feed commands are never replayed; the caller shows a notice.
 */
async function purgeUnsafeRecords(): Promise<number> {
	const records = await listOutboxRecords();
	const unsafe = records.filter(
		(record: StoredOutboxRecord) => !isBiomassOutboxItem(record) || looksLikeFeedCommand(record),
	);
	for (const record of unsafe) {
		await removeOutboxItem(record.id);
	}
	return unsafe.length;
}

async function runReplay(scope: string, discardedFeed: number): Promise<FlushOutboxResult> {
	if (!isBrowserOnline()) {
		return {
			synced: 0,
			remaining: await remainingForScope(scope),
			errors: [],
			failures: await failuresForScope(scope),
			discardedFeed,
			busy: false,
		};
	}

	// Only pending items are retried automatically. Failed/conflicted items stay
	// visible until the user retries or discards them.
	const items = (await listOutbox()).filter(
		(item) => item.payload.scope === scope && item.status === "pending",
	);
	let synced = 0;
	const errors: string[] = [];

	for (const item of items) {
		if (!isBrowserOnline()) break;
		try {
			const result = await saveBiomassLog(buildFormData(item));
			if (result.success) {
				await removeOutboxItem(item.id);
				synced += 1;
				continue;
			}

			const kind = classifyFailure(result.error);
			errors.push(result.error);
			if (kind === "conflict") {
				await markOutboxConflict(item.id, result.error);
				continue;
			}

			const attempts = item.attempts + 1;
			await markOutboxAttempt(item.id, result.error);
			if (kind === "session" || attempts >= MAX_ATTEMPTS) break;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Network error";
			const kind = classifyFailure(message);
			errors.push(message);
			if (kind === "conflict") {
				await markOutboxConflict(item.id, message);
				continue;
			}
			await markOutboxAttempt(item.id, message);
			break;
		}
	}

	return {
		synced,
		remaining: await remainingForScope(scope),
		errors,
		failures: await failuresForScope(scope),
		discardedFeed,
		busy: false,
	};
}

async function withReplayLock<T>(fn: () => Promise<T>): Promise<T> {
	const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
	if (locks && typeof locks.request === "function") {
		return locks.request(REPLAY_LOCK, { mode: "exclusive" }, fn);
	}
	return fn();
}

/**
 * Replay the queued offline samples through the same server action the form
 * uses. Sequential on purpose: preserves order and stops on a lost session so
 * the rest of the queue is not burned through with 401s.
 *
 * Each item carries its clientEventId, so a reload or a duplicated replay can
 * never insert the sample twice. A cross-tab Web Lock keeps two tabs from
 * replaying the same queue concurrently.
 */
export async function flushBiomassOutbox(scope: string): Promise<FlushOutboxResult> {
	if (replaying) {
		return {
			synced: 0,
			remaining: await remainingForScope(scope),
			errors: [],
			failures: await failuresForScope(scope),
			discardedFeed: 0,
			busy: true,
		};
	}

	replaying = true;
	try {
		const discardedFeed = await purgeUnsafeRecords();
		return await withReplayLock(() => runReplay(scope, discardedFeed));
	} finally {
		replaying = false;
	}
}
