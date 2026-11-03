export interface BiomassOutboxPayload {
	clientEventId: string;
	pondId: string;
	scope: string;
	sampleCount: number;
	sampleWeightKg: number;
	sampleLengthCm: number;
	batchLabel: string | null;
	recordedAt: string;
	fishSamples?: Array<{ weightGrams: number; lengthCm: number }>;
}

export type OutboxItemStatus = "pending" | "failed" | "conflict";

/**
 * A queued biomass sample. `idempotencyKey` mirrors `payload.clientEventId`,
 * which the server uses as the BiomassLog primary key: replaying the same item
 * after a reload/tab crash can never create a second row (P2002 is treated as
 * success by `saveBiomassLog`).
 */
export interface OutboxItem {
	id: string;
	type: "biomass";
	payload: BiomassOutboxPayload;
	createdAt: string;
	attempts: number;
	status: OutboxItemStatus;
	lastError?: string;
	idempotencyKey?: string;
	/** Set while a replay owns this item; never sent by a second replay before it expires. */
	claimedAt?: string;
}

/** Any record found in the queue, including legacy/foreign (e.g. feed) items. */
export interface StoredOutboxRecord {
	id: string;
	type: string;
	payload: unknown;
	createdAt: string;
	attempts: number;
	status: OutboxItemStatus;
	lastError?: string;
	idempotencyKey?: string;
	claimedAt?: string;
}

export interface FeedCommandQueueRefusal {
	queued: false;
	code: "feed_commands_never_queued";
}

export const OUTBOX_STORAGE_KEY = "optifeed:offline:outbox:v1";
export const OUTBOX_CHANGED_EVENT = "optifeed:outbox-changed";
/** Automatic attempts before an item is parked as `failed` for a manual retry. */
export const OUTBOX_MAX_ATTEMPTS = 3;
/**
 * How long a replay may hold an item before another replay can reclaim it.
 * Covers a tab that was closed or crashed mid-send. The server's idempotency
 * key still makes the retry safe.
 */
export const OUTBOX_CLAIM_TTL_MS = 2 * 60_000;

const DB_NAME = "optifeed-offline-outbox";
const DB_VERSION = 1;
const STORE = "queue";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItemStatus(value: unknown): value is OutboxItemStatus {
	return value === "pending" || value === "failed" || value === "conflict";
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
	});
}

function hasIndexedDb(): boolean {
	return typeof indexedDB !== "undefined";
}

function notifyChanged(): void {
	if (typeof window === "undefined") return;
	try {
		window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
	} catch {
		// Notifications are best-effort; the queue itself is unaffected.
	}
}

function normalizeRecord(value: unknown): StoredOutboxRecord | null {
	if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
	return {
		id: value.id,
		type: typeof value.type === "string" ? value.type : "unknown",
		payload: value.payload,
		createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
		attempts: typeof value.attempts === "number" ? value.attempts : 0,
		status: isItemStatus(value.status) ? value.status : "pending",
		lastError: typeof value.lastError === "string" ? value.lastError : undefined,
		idempotencyKey: typeof value.idempotencyKey === "string" ? value.idempotencyKey : undefined,
		claimedAt: typeof value.claimedAt === "string" ? value.claimedAt : undefined,
	};
}

function readFallback(): StoredOutboxRecord[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.map(normalizeRecord).filter((item): item is StoredOutboxRecord => item !== null);
	} catch {
		return [];
	}
}

function writeFallback(items: StoredOutboxRecord[]): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
	} catch {
		// Quota/private mode: IndexedDB is the primary store.
	}
}

export function newClientEventId(): string {
	const uuid =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	return `offline-${uuid}`;
}

export function isBiomassOutboxItem(record: unknown): record is OutboxItem {
	if (!isRecord(record)) return false;
	if (record.type !== "biomass") return false;
	if (!isRecord(record.payload)) return false;
	const payload = record.payload;
	return (
		typeof payload.clientEventId === "string" &&
		typeof payload.pondId === "string" &&
		typeof payload.scope === "string" &&
		typeof payload.sampleCount === "number" &&
		typeof payload.sampleWeightKg === "number" &&
		typeof payload.sampleLengthCm === "number"
	);
}

/**
 * Old builds (and any buggy client) could have stored a feeder command in the
 * outbox. Feeding is risky and time-sensitive: a queued command must never be
 * replayed later, so matching records are discarded instead of sent.
 */
export function looksLikeFeedCommand(record: StoredOutboxRecord): boolean {
	if (record.type === "feed") return true;
	if (!isRecord(record.payload)) return false;
	return (
		typeof record.payload.deviceId === "string" ||
		typeof record.payload.command === "string" ||
		typeof record.payload.action === "string" ||
		typeof record.payload.grams === "number"
	);
}

export async function enqueueBiomassSample(payload: BiomassOutboxPayload): Promise<boolean> {
	const item: OutboxItem = {
		id: payload.clientEventId,
		type: "biomass",
		payload,
		createdAt: new Date().toISOString(),
		attempts: 0,
		status: "pending",
		idempotencyKey: payload.clientEventId,
	};

	await upsertRecord(item);
	// Do not report "saved" when both stores rejected the write (private mode,
	// quota, blocked storage): the form must tell the user it was not queued.
	return (await listOutboxRecords()).some((record) => record.id === item.id);
}

/**
 * Feeding safety: a feed/pause/resume command is never queued. It always needs
 * a fresh, online confirmation, so this is deliberately a refusal rather than
 * a no-op stored item.
 */
export async function enqueueFeedCommand(_command?: unknown): Promise<FeedCommandQueueRefusal> {
	return { queued: false, code: "feed_commands_never_queued" };
}

async function upsertRecord(record: StoredOutboxRecord, notify = true): Promise<void> {
	if (hasIndexedDb()) {
		try {
			const db = await openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, "readwrite");
				tx.objectStore(STORE).put(record);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
			});
			db.close();
		} catch {
			// Fall through to localStorage.
		}
	}

	const items = readFallback().filter((item) => item.id !== record.id);
	items.push(record);
	writeFallback(items);
	if (notify) notifyChanged();
}

async function readDbItems(): Promise<StoredOutboxRecord[]> {
	if (!hasIndexedDb()) return [];
	const db = await openDb();
	try {
		return await new Promise<StoredOutboxRecord[]>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const request = tx.objectStore(STORE).getAll();
			request.onsuccess = () => {
				const rows = (request.result as unknown[]) ?? [];
				resolve(
					rows.map(normalizeRecord).filter((item): item is StoredOutboxRecord => item !== null),
				);
			};
			request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
		});
	} finally {
		db.close();
	}
}

/**
 * Every record in the queue, including feed/foreign records that must be
 * discarded rather than replayed.
 */
export async function listOutboxRecords(): Promise<StoredOutboxRecord[]> {
	let dbItems: StoredOutboxRecord[] = [];
	try {
		dbItems = await readDbItems();
	} catch {
		// Fall back to localStorage.
	}

	const merged = new Map<string, StoredOutboxRecord>();
	for (const item of readFallback()) merged.set(item.id, item);
	// IndexedDB is authoritative when both stores have the same id.
	for (const item of dbItems) merged.set(item.id, item);

	return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listOutbox(): Promise<OutboxItem[]> {
	return (await listOutboxRecords())
		.filter(isBiomassOutboxItem)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeOutboxItem(id: string): Promise<void> {
	if (hasIndexedDb()) {
		try {
			const db = await openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, "readwrite");
				tx.objectStore(STORE).delete(id);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
			});
			db.close();
		} catch {
			// Fall through to localStorage.
		}
	}
	writeFallback(readFallback().filter((item) => item.id !== id));
	notifyChanged();
}

/**
 * A claim is only valid for `OUTBOX_CLAIM_TTL_MS`. After that, a replay that
 * died mid-send cannot strand the item forever.
 */
export function isOutboxClaimActive(
	record: Pick<StoredOutboxRecord, "claimedAt">,
	now = Date.now(),
): boolean {
	if (!record.claimedAt) return false;
	const claimedAt = Date.parse(record.claimedAt);
	if (Number.isNaN(claimedAt)) return false;
	return now - claimedAt < OUTBOX_CLAIM_TTL_MS;
}

/**
 * Claim one item for this replay. Returns the freshest record when the claim
 * was taken, or `null` when another replay already owns it (or it is gone).
 *
 * Replays already serialise through a Web Lock; the per-item marker is the
 * durable half of that guard, so even a double drain (two timers, a remount,
 * a reload during a send) cannot submit the same sample twice. Reads and
 * writes are not atomic across tabs, but a lost race still cannot duplicate
 * the row: the server keys the sample on `clientEventId`.
 */
export async function claimOutboxItem(id: string): Promise<OutboxItem | null> {
	const record = (await listOutboxRecords()).find((entry) => entry.id === id);
	if (!record || !isBiomassOutboxItem(record)) return null;
	if (record.status !== "pending") return null;
	if (isOutboxClaimActive(record)) return null;

	const claimed: StoredOutboxRecord = { ...record, claimedAt: new Date().toISOString() };
	await upsertRecord(claimed, false);
	return isBiomassOutboxItem(claimed) ? claimed : null;
}

async function updateItem(
	id: string,
	patch: (item: StoredOutboxRecord) => StoredOutboxRecord,
): Promise<void> {
	const record = (await listOutboxRecords()).find((entry) => entry.id === id);
	if (!record) return;
	await upsertRecord(patch(record));
}

export async function markOutboxAttempt(id: string, error: string): Promise<void> {
	await updateItem(id, (item) => {
		const attempts = item.attempts + 1;
		return {
			...item,
			attempts,
			status: attempts >= OUTBOX_MAX_ATTEMPTS ? "failed" : "pending",
			lastError: error,
			// The attempt is over: a later flush (timer or manual) may retry it.
			claimedAt: undefined,
		};
	});
}

/** A permanent rejection (validation, missing pond, forbidden): retrying unchanged is pointless. */
export async function markOutboxConflict(id: string, error: string): Promise<void> {
	await updateItem(id, (item) => ({
		...item,
		attempts: item.attempts + 1,
		status: "conflict",
		lastError: error,
		claimedAt: undefined,
	}));
}

/** Put a failed/conflicted item back in line for the next replay. */
export async function resetOutboxItem(id: string): Promise<void> {
	await updateItem(id, (item) => ({
		...item,
		attempts: 0,
		status: "pending",
		lastError: undefined,
		claimedAt: undefined,
	}));
}

export async function clearOutbox(): Promise<void> {
	if (typeof window !== "undefined") {
		try {
			window.localStorage.removeItem(OUTBOX_STORAGE_KEY);
		} catch {
			// Ignore.
		}
	}
	if (hasIndexedDb()) {
		await new Promise<void>((resolve) => {
			const request = indexedDB.deleteDatabase(DB_NAME);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			request.onblocked = () => resolve();
		});
	}
	notifyChanged();
}
