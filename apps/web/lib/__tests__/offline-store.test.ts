import { beforeEach, describe, expect, it } from "vitest";
import {
	clearOfflineData,
	getOfflineMeta,
	getOfflineSnapshots,
	saveOfflineSnapshot,
} from "../offline/db";
import { enqueueBiomassSample, listOutbox, removeOutboxItem } from "../offline/outbox";

beforeEach(() => {
	window.localStorage.clear();
});

describe("offline snapshot store fallback", () => {
	it("saves a per-pond snapshot and the active pond", async () => {
		await saveOfflineSnapshot({
			page: "schedule",
			scope: "farm-1",
			pondId: "pond-1",
			pondName: "Demo Pond",
			data: { scheduleStart: "06:00", scheduleEnd: "18:00" },
		});

		const snapshots = await getOfflineSnapshots();
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({
			page: "schedule",
			scope: "farm-1",
			pondId: "pond-1",
			pondName: "Demo Pond",
		});
		expect(await getOfflineMeta()).toMatchObject({
			scope: "farm-1",
			pondId: "pond-1",
		});
	});

	it("clears snapshots and queued samples on sign-out", async () => {
		await saveOfflineSnapshot({
			page: "dashboard",
			scope: "farm-1",
			pondId: "pond-1",
			pondName: "Demo Pond",
			data: { pondName: "Demo Pond" },
		});
		await enqueueBiomassSample({
			clientEventId: "offline-test-1234",
			pondId: "pond-1",
			scope: "farm-1",
			sampleCount: 10,
			sampleWeightKg: 1.5,
			sampleLengthCm: 22,
			batchLabel: "Batch A",
			recordedAt: new Date().toISOString(),
		});

		await clearOfflineData();

		expect(await getOfflineSnapshots()).toEqual([]);
		expect(await listOutbox()).toEqual([]);
		expect(await getOfflineMeta()).toBeNull();
	});
});

describe("biomass outbox fallback", () => {
	it("queues, lists and removes a sample", async () => {
		await enqueueBiomassSample({
			clientEventId: "offline-sample-1",
			pondId: "pond-1",
			scope: "farm-1",
			sampleCount: 20,
			sampleWeightKg: 3.4,
			sampleLengthCm: 24,
			batchLabel: null,
			recordedAt: new Date().toISOString(),
		});

		const items = await listOutbox();
		expect(items).toHaveLength(1);
		expect(items[0].payload.clientEventId).toBe("offline-sample-1");

		await removeOutboxItem("offline-sample-1");
		expect(await listOutbox()).toEqual([]);
	});
});
