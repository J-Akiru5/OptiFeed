import { DASHBOARD_SNAPSHOT_KEY } from "../pwa/snapshot";
import { clearOutbox } from "./outbox";
import type {
	OfflineMeta,
	OfflinePage,
	OfflineSnapshotInput,
	OfflineSnapshotRecord,
} from "./snapshots";

export const OFFLINE_DB_NAME = "optifeed-offline";
export const OFFLINE_DB_VERSION = 1;
const SNAPSHOTS_STORE = "snapshots";
const META_STORE = "meta";
export const OFFLINE_FALLBACK_KEY = "optifeed:offline:snapshots:v1";
export const OFFLINE_META_KEY = "optifeed:offline:active:v1";
export const OFFLINE_USER_KEY = "optifeed:offline:user:v1";
export const LEGACY_DASHBOARD_KEY = "optifeed:pwa:dashboard:v1";

export function offlineSnapshotKey(scope: string, pondId: string, page: OfflinePage): string {
	return `${scope}:${pondId}:${page}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
				const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "key" });
				store.createIndex("scope", "scope");
				store.createIndex("savedAt", "savedAt");
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
	});
}

function hasIndexedDb(): boolean {
	return typeof indexedDB !== "undefined";
}

function readFallbackMap(): Record<string, OfflineSnapshotRecord> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(OFFLINE_FALLBACK_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		return parsed as Record<string, OfflineSnapshotRecord>;
	} catch {
		return {};
	}
}

function writeFallbackMap(map: Record<string, OfflineSnapshotRecord>): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(OFFLINE_FALLBACK_KEY, JSON.stringify(map));
	} catch {
		// Quota/private mode: IndexedDB is the primary store.
	}
}

function readLegacyDashboard(): OfflineSnapshotRecord<unknown> | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(LEGACY_DASHBOARD_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed) || parsed.version !== 1) return null;
		return {
			key: "legacy:legacy:dashboard",
			version: 1,
			page: "dashboard",
			scope: "legacy",
			pondId: "legacy",
			pondName: typeof parsed.pondName === "string" ? parsed.pondName : "Pond",
			data: parsed,
			savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
		};
	} catch {
		return null;
	}
}

export async function saveOfflineSnapshot<T>(input: OfflineSnapshotInput<T>): Promise<void> {
	const record: OfflineSnapshotRecord<T> = {
		...input,
		data: JSON.parse(JSON.stringify(input.data)) as T,
		key: offlineSnapshotKey(input.scope, input.pondId, input.page),
		version: 1,
		savedAt: new Date().toISOString(),
	};

	if (hasIndexedDb()) {
		try {
			const db = await openDb();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction([SNAPSHOTS_STORE, META_STORE], "readwrite");
				tx.objectStore(SNAPSHOTS_STORE).put(record);
				if (input.active !== false) {
					const meta: OfflineMeta = {
						key: "active",
						scope: input.scope,
						pondId: input.pondId,
						pondName: input.pondName,
						savedAt: record.savedAt,
					};
					tx.objectStore(META_STORE).put(meta);
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
			});
			db.close();
		} catch {
			// Fall through to localStorage.
		}
	}

	const map = readFallbackMap();
	map[record.key] = record;
	writeFallbackMap(map);

	if (typeof window !== "undefined" && input.active !== false) {
		try {
			const meta: OfflineMeta = {
				key: "active",
				scope: input.scope,
				pondId: input.pondId,
				pondName: input.pondName,
				savedAt: record.savedAt,
			};
			window.localStorage.setItem(OFFLINE_META_KEY, JSON.stringify(meta));
		} catch {
			// Meta is best-effort.
		}
	}
}

async function readIndexedDbSnapshots(): Promise<OfflineSnapshotRecord[]> {
	if (!hasIndexedDb()) return [];
	const db = await openDb();
	try {
		return await new Promise<OfflineSnapshotRecord[]>((resolve, reject) => {
			const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
			const request = tx.objectStore(SNAPSHOTS_STORE).getAll();
			request.onsuccess = () => resolve((request.result as OfflineSnapshotRecord[]) ?? []);
			request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
		});
	} finally {
		db.close();
	}
}

export async function getOfflineSnapshots(): Promise<OfflineSnapshotRecord[]> {
	try {
		const indexed = await readIndexedDbSnapshots();
		if (indexed.length > 0) {
			return indexed.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
		}
	} catch {
		// Fall back to localStorage.
	}

	const fallback = Object.values(readFallbackMap());
	if (fallback.length > 0) {
		return fallback.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
	}

	const legacy = readLegacyDashboard();
	return legacy ? [legacy] : [];
}

export async function getOfflineMeta(): Promise<OfflineMeta | null> {
	if (typeof window !== "undefined") {
		try {
			const raw = window.localStorage.getItem(OFFLINE_META_KEY);
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				if (isRecord(parsed) && parsed.key === "active") {
					return {
						key: "active",
						scope: typeof parsed.scope === "string" ? parsed.scope : "",
						pondId: typeof parsed.pondId === "string" ? parsed.pondId : "",
						pondName: typeof parsed.pondName === "string" ? parsed.pondName : "",
						savedAt:
							typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
					};
				}
			}
		} catch {
			// Fall through to IndexedDB.
		}
	}

	if (!hasIndexedDb()) return null;
	try {
		const db = await openDb();
		try {
			return await new Promise<OfflineMeta | null>((resolve, reject) => {
				const tx = db.transaction(META_STORE, "readonly");
				const request = tx.objectStore(META_STORE).get("active");
				request.onsuccess = () => resolve((request.result as OfflineMeta | undefined) ?? null);
				request.onerror = () => reject(request.error ?? new Error("IndexedDB meta read failed"));
			});
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

export async function clearOfflineData(): Promise<void> {
	await clearOutbox();
	if (typeof window !== "undefined") {
		try {
			window.localStorage.removeItem(OFFLINE_FALLBACK_KEY);
			window.localStorage.removeItem(OFFLINE_META_KEY);
			window.localStorage.removeItem(OFFLINE_USER_KEY);
			window.localStorage.removeItem(LEGACY_DASHBOARD_KEY);
			// The pre-IndexedDB dashboard snapshot is separate from the store above.
			window.localStorage.removeItem(DASHBOARD_SNAPSHOT_KEY);
		} catch {
			// Storage may be unavailable.
		}
	}

	if (!hasIndexedDb()) return;
	await new Promise<void>((resolve) => {
		const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

/**
 * Which account this device last cached offline data for. Scoped to the whole
 * store: when a different user signs in, the previous user's queues and
 * snapshots must not survive.
 */
export function getOfflineUser(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const value = window.localStorage.getItem(OFFLINE_USER_KEY);
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

export function recordOfflineUser(userId: string): void {
	if (typeof window === "undefined" || userId.length === 0) return;
	try {
		window.localStorage.setItem(OFFLINE_USER_KEY, userId);
	} catch {
		// Identity tracking is best-effort.
	}
}

/**
 * Clears every cached snapshot/queue when the signed-in user changes. Returns
 * true when data was cleared. Call this once per authenticated dashboard mount.
 */
export async function clearOfflineDataIfUserChanged(userId: string): Promise<boolean> {
	if (!userId) return false;
	const previous = getOfflineUser();
	if (previous !== null && previous !== userId) {
		await clearOfflineData();
		recordOfflineUser(userId);
		return true;
	}
	recordOfflineUser(userId);
	return false;
}
