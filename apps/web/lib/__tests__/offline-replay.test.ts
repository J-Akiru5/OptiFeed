import { saveBiomassLog } from "@/lib/actions/biomass";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	OUTBOX_STORAGE_KEY,
	enqueueBiomassSample,
	enqueueFeedCommand,
	listOutbox,
	listOutboxRecords,
	resetOutboxItem,
} from "../offline/outbox";
import { flushBiomassOutbox } from "../offline/sync";

vi.mock("@/lib/actions/biomass", () => ({ saveBiomassLog: vi.fn() }));

const mockedSave = vi.mocked(saveBiomassLog);

function savedOk() {
	return { success: true, feed: {} } as never;
}

function rejected(error: string) {
	return { success: false, error } as never;
}

function sample(clientEventId = "offline-replay-0001", scope = "farm-1") {
	return {
		clientEventId,
		pondId: "pond-1",
		scope,
		sampleCount: 20,
		sampleWeightKg: 3.4,
		sampleLengthCm: 24,
		batchLabel: null,
		recordedAt: "2026-10-26T08:00:00.000Z",
	};
}

beforeEach(() => {
	window.localStorage.clear();
	mockedSave.mockReset();
	mockedSave.mockResolvedValue(savedOk());
});

describe("offline replay is exactly once", () => {
	it("sends the idempotency key and removes the item after one successful replay", async () => {
		await enqueueBiomassSample(sample());

		const first = await flushBiomassOutbox("farm-1");
		expect(first.synced).toBe(1);
		expect(first.remaining).toBe(0);
		expect(mockedSave).toHaveBeenCalledTimes(1);

		const body = mockedSave.mock.calls[0]?.[0] as FormData;
		expect(body.get("clientEventId")).toBe("offline-replay-0001");
		expect(body.get("idempotencyKey")).toBe("offline-replay-0001");
		expect(body.get("pondId")).toBe("pond-1");

		const second = await flushBiomassOutbox("farm-1");
		expect(second.synced).toBe(0);
		expect(mockedSave).toHaveBeenCalledTimes(1);
		expect(await listOutbox()).toEqual([]);
	});

	it("suppresses a duplicate enqueue with the same client event id", async () => {
		await enqueueBiomassSample(sample());
		await enqueueBiomassSample(sample());

		expect(await listOutbox()).toHaveLength(1);

		await flushBiomassOutbox("farm-1");
		expect(mockedSave).toHaveBeenCalledTimes(1);
	});

	it("survives a reload because the queue is persisted, not held in memory", async () => {
		await enqueueBiomassSample(sample());

		vi.resetModules();
		const reloaded = await import("../offline/outbox");
		const items = await reloaded.listOutbox();

		expect(items).toHaveLength(1);
		expect(items[0]?.payload.clientEventId).toBe("offline-replay-0001");
	});
});

describe("offline replay surfaces failures", () => {
	it("marks a permanent rejection as a conflict instead of dropping it", async () => {
		await enqueueBiomassSample(sample());
		mockedSave.mockResolvedValueOnce(rejected("Pond not found"));

		const result = await flushBiomassOutbox("farm-1");
		expect(result.synced).toBe(0);
		expect(result.remaining).toBe(1);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			id: "offline-replay-0001",
			status: "conflict",
			error: "Pond not found",
		});

		// A conflict is not auto-replayed; the user must retry or discard it.
		const second = await flushBiomassOutbox("farm-1");
		expect(mockedSave).toHaveBeenCalledTimes(1);
		expect(second.failures[0]?.status).toBe("conflict");

		// Retrying after the cause is fixed sends it once and clears the queue.
		mockedSave.mockResolvedValue(savedOk());
		await resetOutboxItem("offline-replay-0001");
		const third = await flushBiomassOutbox("farm-1");
		expect(third.synced).toBe(1);
		expect(await listOutbox()).toEqual([]);
	});

	it("keeps a retryable failure visible after three attempts", async () => {
		await enqueueBiomassSample(sample());
		mockedSave.mockResolvedValue(rejected("Something went wrong"));

		await flushBiomassOutbox("farm-1");
		await flushBiomassOutbox("farm-1");
		const third = await flushBiomassOutbox("farm-1");

		expect(third.failures[0]).toMatchObject({
			status: "failed",
			attempts: 3,
		});
		expect(await listOutbox()).toHaveLength(1);
	});
});

describe("feeding safety", () => {
	it("never queues a feed command", async () => {
		const refusal = await enqueueFeedCommand({
			deviceId: "device-1",
			command: "manual_feed",
			grams: 500,
		});

		expect(refusal).toEqual({ queued: false, code: "feed_commands_never_queued" });
		expect(await listOutboxRecords()).toEqual([]);
	});

	it("purges an old queued feed command without sending it", async () => {
		window.localStorage.setItem(
			OUTBOX_STORAGE_KEY,
			JSON.stringify([
				{
					id: "legacy-feed-1",
					type: "feed",
					payload: { deviceId: "device-1", command: "manual_feed", grams: 500 },
					createdAt: "2026-10-26T08:00:00.000Z",
					attempts: 0,
					status: "pending",
				},
			]),
		);

		const result = await flushBiomassOutbox("farm-1");

		expect(result.discardedFeed).toBe(1);
		expect(mockedSave).not.toHaveBeenCalled();
		expect(await listOutboxRecords()).toEqual([]);
	});

	it("purges a feed-shaped record even if it claims to be biomass", async () => {
		window.localStorage.setItem(
			OUTBOX_STORAGE_KEY,
			JSON.stringify([
				{
					id: "legacy-feed-2",
					type: "biomass",
					payload: { deviceId: "device-1", command: "pause" },
					createdAt: "2026-10-26T08:00:00.000Z",
					attempts: 0,
					status: "pending",
				},
			]),
		);

		const result = await flushBiomassOutbox("farm-1");

		expect(result.discardedFeed).toBe(1);
		expect(mockedSave).not.toHaveBeenCalled();
		expect(await listOutboxRecords()).toEqual([]);
	});

	it("still discards unsafe records while offline", async () => {
		const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		try {
			window.localStorage.setItem(
				OUTBOX_STORAGE_KEY,
				JSON.stringify([
					{
						id: "legacy-feed-3",
						type: "feed",
						payload: { deviceId: "device-1", action: "resume" },
						createdAt: "2026-10-26T08:00:00.000Z",
						attempts: 0,
						status: "pending",
					},
				]),
			);

			const result = await flushBiomassOutbox("farm-1");
			expect(result.discardedFeed).toBe(1);
			expect(mockedSave).not.toHaveBeenCalled();
			expect(await listOutboxRecords()).toEqual([]);
		} finally {
			onLine.mockRestore();
		}
	});
});
