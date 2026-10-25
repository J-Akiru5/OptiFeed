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

export interface OutboxItem {
	id: string;
	type: "biomass";
	payload: BiomassOutboxPayload;
	createdAt: string;
	attempts: number;
	status: "pending" | "failed";
	lastError?: string;
}

const DB_NAME = "optifeed-offline-outbox";
const DB_VERSION = 1;
const STORE = "queue";
const FALLBACK_KEY = "optifeed:offline:outbox:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readFallback(): OutboxItem[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(FALLBACK_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((item): item is OutboxItem => isRecord(item) && typeof item.id === "string")
			: [];
	} catch {
		return [];
	}
}

function writeFallback(items: OutboxItem[]): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(items));
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

export async function enqueueBiomassSample(payload: BiomassOutboxPayload): Promise<boolean> {
	const item: OutboxItem = {
		id: payload.clientEventId,
		type: "biomass",
		payload,
		createdAt: new Date().toISOString(),
		attempts: 0,
		status: "pending",
	};

	if (hasIndexedDb()) {
		try {
			const db = await openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, "readwrite");
				tx.objectStore(STORE).put(item);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
			});
			db.close();
			return true;
		} catch {
			// Fall through to localStorage.
		}
	}

	const items = readFallback();
	items.push(item);
	writeFallback(items);
	return true;
}

async function readDbItems(): Promise<OutboxItem[]> {
	if (!hasIndexedDb()) return [];
	const db = await openDb();
	try {
		return await new Promise<OutboxItem[]>((resolve, reject) => {
			const tx = db.transaction(STORE, "readonly");
			const request = tx.objectStore(STORE).getAll();
			request.onsuccess = () => resolve((request.result as OutboxItem[]) ?? []);
			request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
		});
	} finally {
		db.close();
	}
}

export async function listOutbox(): Promise<OutboxItem[]> {
	try {
		const items = await readDbItems();
		if (items.length > 0) {
			return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		}
	} catch {
		// Fall back.
	}
	return readFallback().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
}

export async function markOutboxAttempt(id: string, error: string): Promise<void> {
	const items = await listOutbox();
	const item = items.find((entry) => entry.id === id);
	if (!item) return;
	const next: OutboxItem = {
		...item,
		attempts: item.attempts + 1,
		status: item.attempts + 1 >= 3 ? "failed" : "pending",
		lastError: error,
	};
	if (hasIndexedDb()) {
		try {
			const db = await openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(STORE, "readwrite");
				tx.objectStore(STORE).put(next);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
			});
			db.close();
			return;
		} catch {
			// Fall through.
		}
	}
	writeFallback(items.map((entry) => (entry.id === id ? next : entry)));
}

export async function clearOutbox(): Promise<void> {
	if (typeof window !== "undefined") {
		try {
			window.localStorage.removeItem(FALLBACK_KEY);
		} catch {
			// Ignore.
		}
	}
	if (!hasIndexedDb()) return;
	await new Promise<void>((resolve) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}
