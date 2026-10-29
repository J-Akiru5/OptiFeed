import { beforeEach, describe, expect, it } from "vitest";
import {
	LEGACY_DASHBOARD_KEY,
	OFFLINE_FALLBACK_KEY,
	OFFLINE_META_KEY,
	OFFLINE_USER_KEY,
	clearOfflineData,
	clearOfflineDataIfUserChanged,
	getOfflineMeta,
	getOfflineSnapshots,
	getOfflineUser,
	offlineSnapshotKey,
	recordOfflineUser,
	saveOfflineSnapshot,
} from "../offline/db";
import { DASHBOARD_SNAPSHOT_KEY } from "../pwa/snapshot";

/**
 * The offline cache must survive a reload and must not survive a different
 * user signing in. jsdom has no IndexedDB, so these drive the real
 * localStorage fallback the app uses in private mode as well.
 */

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		page: "schedule" as const,
		scope: "farm-1",
		pondId: "pond-1",
		pondName: "Demo Pond",
		data: { scheduleStart: "06:00", scheduleEnd: "18:00" },
		...overrides,
	};
}

beforeEach(() => {
	window.localStorage.clear();
});

describe("snapshot keys", () => {
	it("names a snapshot by scope, pond and page", () => {
		expect(offlineSnapshotKey("farm-1", "pond-1", "growth")).toBe("farm-1:pond-1:growth");
	});
});

describe("saving snapshots", () => {
	it("stores a deep copy so later mutation cannot rewrite the cache", async () => {
		const data = { scheduleStart: "06:00" };
		await saveOfflineSnapshot(snapshot({ data }));

		data.scheduleStart = "09:00";

		const [record] = await getOfflineSnapshots();
		expect(record.data).toEqual({ scheduleStart: "06:00" });
		expect(record).toMatchObject({ key: "farm-1:pond-1:schedule", version: 1 });
	});

	it("marks the pond active and exposes it as the offline meta", async () => {
		await saveOfflineSnapshot(snapshot());

		expect(await getOfflineMeta()).toMatchObject({
			key: "active",
			scope: "farm-1",
			pondId: "pond-1",
			pondName: "Demo Pond",
		});
	});

	it("leaves the active pond alone when the snapshot is not active", async () => {
		await saveOfflineSnapshot(snapshot());
		await saveOfflineSnapshot(
			snapshot({ pondId: "pond-2", pondName: "Other Pond", active: false }),
		);

		expect(await getOfflineMeta()).toMatchObject({ pondId: "pond-1" });
		expect(await getOfflineSnapshots()).toHaveLength(2);
	});

	it("returns snapshots newest first", async () => {
		await saveOfflineSnapshot(snapshot({ page: "dashboard" }));
		await saveOfflineSnapshot(snapshot({ page: "growth" }));
		await saveOfflineSnapshot(snapshot({ page: "history" }));

		const records = await getOfflineSnapshots();
		const savedAt = records.map((record) => record.savedAt);

		expect(records).toHaveLength(3);
		expect([...savedAt].sort().reverse()).toEqual(savedAt);
	});
});

describe("reading a legacy snapshot", () => {
	it("adapts the pre-IndexedDB dashboard snapshot", async () => {
		window.localStorage.setItem(
			LEGACY_DASHBOARD_KEY,
			JSON.stringify({
				version: 1,
				pondName: "Legacy Pond",
				savedAt: "2026-03-01T00:00:00.000Z",
				feedLevelPercent: 55,
			}),
		);

		const [record] = await getOfflineSnapshots();

		expect(record).toMatchObject({
			key: "legacy:legacy:dashboard",
			page: "dashboard",
			scope: "legacy",
			pondId: "legacy",
			pondName: "Legacy Pond",
			savedAt: "2026-03-01T00:00:00.000Z",
		});
	});

	it("ignores a legacy blob from another version", async () => {
		window.localStorage.setItem(LEGACY_DASHBOARD_KEY, JSON.stringify({ version: 2 }));

		expect(await getOfflineSnapshots()).toEqual([]);
	});

	it("ignores a corrupt legacy blob", async () => {
		window.localStorage.setItem(LEGACY_DASHBOARD_KEY, "not-json");

		expect(await getOfflineSnapshots()).toEqual([]);
	});

	it("prefers stored snapshots over the legacy one", async () => {
		window.localStorage.setItem(LEGACY_DASHBOARD_KEY, JSON.stringify({ version: 1 }));
		await saveOfflineSnapshot(snapshot());

		const records = await getOfflineSnapshots();

		expect(records).toHaveLength(1);
		expect(records[0].page).toBe("schedule");
	});

	it("ignores a corrupt snapshot map", async () => {
		window.localStorage.setItem(OFFLINE_FALLBACK_KEY, "[]");

		expect(await getOfflineSnapshots()).toEqual([]);
	});
});

describe("offline meta", () => {
	it("returns null when the stored meta is not the active marker", async () => {
		window.localStorage.setItem(OFFLINE_META_KEY, JSON.stringify({ key: "other" }));

		expect(await getOfflineMeta()).toBeNull();
	});

	it("returns null for a corrupt meta value", async () => {
		window.localStorage.setItem(OFFLINE_META_KEY, "not-json");

		expect(await getOfflineMeta()).toBeNull();
	});
});

describe("cached identity", () => {
	it("records and returns the signed-in user", () => {
		recordOfflineUser("user-1");

		expect(getOfflineUser()).toBe("user-1");
	});

	it("does not overwrite the cache with an empty user id", () => {
		recordOfflineUser("user-1");
		recordOfflineUser("");

		expect(getOfflineUser()).toBe("user-1");
	});

	it("reports no user when nothing was cached or the value is empty", () => {
		expect(getOfflineUser()).toBeNull();

		window.localStorage.setItem(OFFLINE_USER_KEY, "");
		expect(getOfflineUser()).toBeNull();
	});

	it("keeps the cache for the same user signing back in", async () => {
		await saveOfflineSnapshot(snapshot());
		recordOfflineUser("user-1");

		await expect(clearOfflineDataIfUserChanged("user-1")).resolves.toBe(false);
		expect(await getOfflineSnapshots()).toHaveLength(1);
	});

	it("wipes the previous user's snapshots when a different user signs in", async () => {
		await saveOfflineSnapshot(snapshot());
		recordOfflineUser("user-1");

		await expect(clearOfflineDataIfUserChanged("user-2")).resolves.toBe(true);

		expect(getOfflineUser()).toBe("user-2");
		expect(await getOfflineSnapshots()).toEqual([]);
		expect(await getOfflineMeta()).toBeNull();
	});

	it("records the first user on a fresh device without clearing anything", async () => {
		await saveOfflineSnapshot(snapshot());

		await expect(clearOfflineDataIfUserChanged("user-1")).resolves.toBe(false);

		expect(getOfflineUser()).toBe("user-1");
		expect(await getOfflineSnapshots()).toHaveLength(1);
	});

	it("does nothing for an empty user id", async () => {
		recordOfflineUser("user-1");

		await expect(clearOfflineDataIfUserChanged("")).resolves.toBe(false);
		expect(getOfflineUser()).toBe("user-1");
	});
});

describe("clearing", () => {
	it("removes snapshots, meta, identity and the legacy dashboard cache", async () => {
		await saveOfflineSnapshot(snapshot());
		recordOfflineUser("user-1");
		window.localStorage.setItem(LEGACY_DASHBOARD_KEY, JSON.stringify({ version: 1 }));
		window.localStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify({ pondName: "x" }));

		await clearOfflineData();

		expect(await getOfflineSnapshots()).toEqual([]);
		expect(await getOfflineMeta()).toBeNull();
		expect(getOfflineUser()).toBeNull();
		expect(window.localStorage.getItem(LEGACY_DASHBOARD_KEY)).toBeNull();
		expect(window.localStorage.getItem(DASHBOARD_SNAPSHOT_KEY)).toBeNull();
	});
});
