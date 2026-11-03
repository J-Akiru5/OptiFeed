import { saveBiomassLog } from "@/lib/actions/biomass";
import { isBrowserOnline } from "@/lib/pwa/feed-safety";
import {
	OUTBOX_MAX_ATTEMPTS,
	type OutboxItem,
	type StoredOutboxRecord,
	claimOutboxItem,
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
	/** Items that used up every automatic attempt during this flush and now need a manual retry. */
	exhausted: number;
}

const REPLAY_LOCK = "optifeed-outbox-replay";

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

async function idleResult(
	scope: string,
	discardedFeed: number,
	busy: boolean,
): Promise<FlushOutboxResult> {
	const [remaining, failures] = await Promise.all([
		remainingForScope(scope),
		failuresForScope(scope),
	]);
	return {
		synced: 0,
		remaining,
		errors: [],
		failures,
		discardedFeed,
		busy,
		exhausted: 0,
	};
}

async function runReplay(scope: string, discardedFeed: number): Promise<FlushOutboxResult> {
	if (!isBrowserOnline()) {
		return idleResult(scope, discardedFeed, false);
	}

	// Only pending items are retried automatically. Failed/conflicted items stay
	// visible until the user retries or discards them. `listOutbox` sorts oldest
	// first, and the loop sends one at a time, so samples for a pond keep their
	// order.
	const candidates = (await listOutbox()).filter(
		(item) => item.payload.scope === scope && item.status === "pending",
	);
	let synced = 0;
	let exhausted = 0;
	const errors: string[] = [];
	// If an earlier sample for a pond is claimed elsewhere (another drain, or a
	// stale claim after a crash), hold that pond's later samples back for this
	// pass instead of sending them out of order. The next timer retries it.
	const blockedPonds = new Set<string>();

	for (const candidate of candidates) {
		if (!isBrowserOnline()) break;
		if (blockedPonds.has(candidate.payload.pondId)) continue;

		// Claim before sending. A second drain (the online handler racing the
		// timer, a remount, another tab after the lock) gets no claim and skips
		// the item, so the same sample is never submitted twice.
		const item = await claimOutboxItem(candidate.id);
		if (!item) {
			blockedPonds.add(candidate.payload.pondId);
			continue;
		}

		try {
			const result = await saveBiomassLog(buildFormData(item));
			if (result.success) {
				// Remove on success only: a failed attempt keeps the item queued.
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
			if (attempts >= OUTBOX_MAX_ATTEMPTS) exhausted += 1;
			if (kind === "session" || attempts >= OUTBOX_MAX_ATTEMPTS) break;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Network error";
			const kind = classifyFailure(message);
			errors.push(message);
			if (kind === "conflict") {
				await markOutboxConflict(item.id, message);
				continue;
			}
			const attempts = item.attempts + 1;
			await markOutboxAttempt(item.id, message);
			if (attempts >= OUTBOX_MAX_ATTEMPTS) exhausted += 1;
			break;
		}
	}

	// Never drop an item silently: an item that used up its attempts becomes
	// `failed` and stays in the panel for a user decision. The console line is
	// for field diagnostics when nobody is looking at the panel.
	if (exhausted > 0) {
		console.warn(
			`[offline-sync] ${exhausted} queued sample(s) used all ${OUTBOX_MAX_ATTEMPTS} automatic attempts and need a manual retry`,
		);
	}

	return {
		synced,
		remaining: await remainingForScope(scope),
		errors,
		failures: await failuresForScope(scope),
		discardedFeed,
		busy: false,
		exhausted,
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
 * replaying the same queue concurrently, and each item is additionally claimed
 * before it is sent so a double drain cannot submit it twice.
 *
 * Safe to call from a mount, a timer, an `online` event and an outbox change:
 * callers do not need to coordinate.
 */
export async function flushBiomassOutbox(scope: string): Promise<FlushOutboxResult> {
	if (replaying) {
		return idleResult(scope, 0, true);
	}

	replaying = true;
	try {
		const discardedFeed = await purgeUnsafeRecords();
		return await withReplayLock(() => runReplay(scope, discardedFeed));
	} finally {
		replaying = false;
	}
}
