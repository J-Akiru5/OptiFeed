import { beforeEach, describe, expect, it } from "vitest";
import {
	OUTBOX_STORAGE_KEY,
	clearOutbox,
	enqueueBiomassSample,
	enqueueFeedCommand,
	isBiomassOutboxItem,
	listOutbox,
	listOutboxRecords,
	looksLikeFeedCommand,
	markOutboxAttempt,
	markOutboxConflict,
	newClientEventId,
	removeOutboxItem,
	resetOutboxItem,
} from "../offline/outbox";

/**
 * The offline queue is a safety surface: a biomass sample may be replayed
 * later, but a feeder command must never be. These tests drive the real
 * localStorage fallback (jsdom has no IndexedDB) and assert both the queue
 * behaviour and the "feed commands are never replayed" rule.
 */

function payload(overrides: Record<string, unknown> = {}) {
	return {
		clientEventId: "offline-sample-1",
		pondId: "pond-1",
		scope: "farm-1",
		sampleCount: 20,
		sampleWeightKg: 3.4,
		sampleLengthCm: 24,
		batchLabel: null,
		recordedAt: "2026-03-02T04:00:00.000Z",
		...overrides,
	};
}

beforeEach(() => {
	window.localStorage.clear();
});

describe("client event ids", () => {
	it("prefixes a fresh id and does not repeat", () => {
		const first = newClientEventId();
		const second = newClientEventId();

		expect(first).toMatch(/^offline-/);
		expect(first).not.toBe(second);
	});
});

describe("record classification", () => {
	it("accepts a complete biomass payload", () => {
		expect(isBiomassOutboxItem({ type: "biomass", payload: payload() })).toBe(true);
	});

	it("rejects a biomass payload missing a required number", () => {
		const incomplete = payload();
		Reflect.deleteProperty(incomplete, "sampleCount");

		expect(isBiomassOutboxItem({ type: "biomass", payload: incomplete })).toBe(false);
	});

	it("rejects a non-biomass record and a record without a payload", () => {
		expect(isBiomassOutboxItem({ type: "feed", payload: payload() })).toBe(false);
		expect(isBiomassOutboxItem({ type: "biomass" })).toBe(false);
		expect(isBiomassOutboxItem(null)).toBe(false);
	});

	it("recognises a feeder command by type or by payload shape", () => {
		const record = (type: string, data: unknown) => ({
			id: "1",
			type,
			payload: data,
			createdAt: "",
			attempts: 0,
			status: "pending" as const,
		});

		expect(looksLikeFeedCommand(record("feed", {}))).toBe(true);
		expect(looksLikeFeedCommand(record("biomass", { deviceId: "dev-1" }))).toBe(true);
		expect(looksLikeFeedCommand(record("biomass", { command: "feed" }))).toBe(true);
		expect(looksLikeFeedCommand(record("biomass", { action: "pause" }))).toBe(true);
		expect(looksLikeFeedCommand(record("biomass", { grams: 150 }))).toBe(true);
		expect(looksLikeFeedCommand(record("biomass", payload()))).toBe(false);
	});
});

describe("queueing", () => {
	it("never queues a feed command", async () => {
		await expect(enqueueFeedCommand({ deviceId: "dev-1", grams: 150 })).resolves.toEqual({
			queued: false,
			code: "feed_commands_never_queued",
		});
		expect(window.localStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
	});

	it("stores a biomass sample with an idempotency key matching its client id", async () => {
		await expect(enqueueBiomassSample(payload())).resolves.toBe(true);

		const [item] = await listOutbox();
		expect(item).toMatchObject({
			id: "offline-sample-1",
			type: "biomass",
			status: "pending",
			attempts: 0,
			idempotencyKey: "offline-sample-1",
		});
		expect(item.payload.sampleWeightKg).toBe(3.4);
	});

	it("replaces an item with the same client id instead of duplicating it", async () => {
		await enqueueBiomassSample(payload());
		await enqueueBiomassSample(payload({ sampleCount: 25 }));

		const items = await listOutbox();
		expect(items).toHaveLength(1);
		expect(items[0].payload.sampleCount).toBe(25);
	});

	it("keeps feed-shaped and foreign records visible to the discarding code", async () => {
		window.localStorage.setItem(
			OUTBOX_STORAGE_KEY,
			JSON.stringify([
				{
					id: "legacy-feed",
					type: "feed",
					payload: { deviceId: "dev-1", grams: 150 },
					createdAt: "2026-03-01T00:00:00.000Z",
					attempts: 0,
					status: "pending",
				},
			]),
		);

		expect(await listOutbox()).toEqual([]);
		expect(await listOutboxRecords()).toHaveLength(1);
	});

	it("ignores a corrupt queue instead of throwing", async () => {
		window.localStorage.setItem(OUTBOX_STORAGE_KEY, "not-json");
		expect(await listOutboxRecords()).toEqual([]);

		window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify({ not: "an array" }));
		expect(await listOutboxRecords()).toEqual([]);
	});

	it("normalises a stored record with missing optional fields", async () => {
		window.localStorage.setItem(
			OUTBOX_STORAGE_KEY,
			JSON.stringify([{ id: "offline-old", type: "biomass", payload: payload() }]),
		);

		const [record] = await listOutboxRecords();
		expect(record).toMatchObject({
			id: "offline-old",
			attempts: 0,
			status: "pending",
			createdAt: "1970-01-01T00:00:00.000Z",
		});
	});

	it("lists samples oldest first", async () => {
		await enqueueBiomassSample(payload({ clientEventId: "b" }));
		await enqueueBiomassSample(payload({ clientEventId: "a" }));

		const records = JSON.parse(window.localStorage.getItem(OUTBOX_STORAGE_KEY) ?? "[]");
		records[0].createdAt = "2026-03-01T00:00:00.000Z";
		records[1].createdAt = "2026-03-02T00:00:00.000Z";
		window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(records));

		expect((await listOutbox()).map((item) => item.id)).toEqual(["b", "a"]);
	});
});

describe("retry bookkeeping", () => {
	beforeEach(async () => {
		await enqueueBiomassSample(payload());
	});

	it("stays pending for the first two failures and fails on the third", async () => {
		await markOutboxAttempt("offline-sample-1", "network");
		expect((await listOutbox())[0]).toMatchObject({ attempts: 1, status: "pending" });

		await markOutboxAttempt("offline-sample-1", "network");
		expect((await listOutbox())[0]).toMatchObject({ attempts: 2, status: "pending" });

		await markOutboxAttempt("offline-sample-1", "network");
		expect((await listOutbox())[0]).toMatchObject({
			attempts: 3,
			status: "failed",
			lastError: "network",
		});
	});

	it("marks a permanent rejection as a conflict", async () => {
		await markOutboxConflict("offline-sample-1", "Pond not found");

		expect((await listOutbox())[0]).toMatchObject({
			attempts: 1,
			status: "conflict",
			lastError: "Pond not found",
		});
	});

	it("puts a conflicted item back in line with a clean slate", async () => {
		await markOutboxConflict("offline-sample-1", "Pond not found");

		await resetOutboxItem("offline-sample-1");

		const [item] = await listOutbox();
		expect(item).toMatchObject({ attempts: 0, status: "pending" });
		expect(item.lastError).toBeUndefined();
	});

	it("ignores an attempt for an id that is no longer queued", async () => {
		await markOutboxAttempt("offline-missing", "network");

		expect(await listOutbox()).toHaveLength(1);
	});
});

describe("removal", () => {
	beforeEach(async () => {
		await enqueueBiomassSample(payload());
	});

	it("removes a queued sample", async () => {
		await removeOutboxItem("offline-sample-1");

		expect(await listOutbox()).toEqual([]);
	});

	it("exposes discard as the same operation", async () => {
		await removeOutboxItem("offline-sample-1");

		expect(await listOutbox()).toEqual([]);
	});

	it("clears the whole queue", async () => {
		await clearOutbox();

		expect(await listOutboxRecords()).toEqual([]);
	});
});
