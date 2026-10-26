import { DASHBOARD_SNAPSHOT_KEY, writeDashboardSnapshot } from "@/lib/pwa/snapshot";
import { beforeEach, describe, expect, it } from "vitest";
import {
	OFFLINE_USER_KEY,
	clearOfflineData,
	clearOfflineDataIfUserChanged,
	getOfflineMeta,
	getOfflineSnapshots,
	getOfflineUser,
	saveOfflineSnapshot,
} from "../offline/db";
import { enqueueBiomassSample, listOutbox } from "../offline/outbox";

const dashboard = {
	pondName: "POND-1",
	deviceName: "ESP32",
	deviceStatus: "online" as const,
	lastSeenAt: null,
	feedLevelPercent: null,
	feedLevelUpdatedAt: null,
	waterTempC: null,
	waterTempOk: null,
	waterTempUpdatedAt: null,
	population: 100,
	avgWeightG: null,
	latestFcr: null,
	nextFeedingTime: null,
	nextFeedingVolumeG: null,
	daysUntilSample: 0,
	activeCycleLabel: null,
	targetHarvestDate: null,
	isPaused: false,
};

beforeEach(() => {
	window.localStorage.clear();
});

async function seedOfflineData() {
	await saveOfflineSnapshot({
		page: "dashboard",
		scope: "farm-1",
		pondId: "pond-1",
		pondName: "POND-1",
		data: { pondName: "POND-1" },
	});
	await enqueueBiomassSample({
		clientEventId: "offline-identity-0001",
		pondId: "pond-1",
		scope: "farm-1",
		sampleCount: 10,
		sampleWeightKg: 1.5,
		sampleLengthCm: 22,
		batchLabel: null,
		recordedAt: "2026-10-26T08:00:00.000Z",
	});
	writeDashboardSnapshot(dashboard);
}

describe("offline data ownership", () => {
	it("clears snapshots, the outbox and the legacy dashboard on sign-out", async () => {
		await seedOfflineData();

		await clearOfflineData();

		expect(await getOfflineSnapshots()).toEqual([]);
		expect(await getOfflineMeta()).toBeNull();
		expect(await listOutbox()).toEqual([]);
		expect(window.localStorage.getItem(DASHBOARD_SNAPSHOT_KEY)).toBeNull();
		expect(window.localStorage.getItem(OFFLINE_USER_KEY)).toBeNull();
	});

	it("keeps the store for the same user", async () => {
		await seedOfflineData();
		expect(await clearOfflineDataIfUserChanged("user-a")).toBe(false);
		expect(await clearOfflineDataIfUserChanged("user-a")).toBe(false);

		expect(await listOutbox()).toHaveLength(1);
		expect(await getOfflineSnapshots()).toHaveLength(1);
		expect(getOfflineUser()).toBe("user-a");
	});

	it("clears everything when a different user signs in", async () => {
		await seedOfflineData();
		expect(await clearOfflineDataIfUserChanged("user-a")).toBe(false);

		const cleared = await clearOfflineDataIfUserChanged("user-b");

		expect(cleared).toBe(true);
		expect(await listOutbox()).toEqual([]);
		expect(await getOfflineSnapshots()).toEqual([]);
		expect(await getOfflineMeta()).toBeNull();
		expect(window.localStorage.getItem(DASHBOARD_SNAPSHOT_KEY)).toBeNull();
		expect(getOfflineUser()).toBe("user-b");
	});
});
