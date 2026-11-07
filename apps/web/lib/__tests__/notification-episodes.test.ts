import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type EpisodeInput,
	type EpisodeResult,
	closeEpisode,
	coldWaterEpisodeKey,
	feedDaysEpisodeKey,
	offlineEpisodeKey,
	openEpisode,
	pelletEpisodeKey,
	resolveEpisodeIfOpen,
} from "@/lib/notifications/episodes";
import { createTenancyDb } from "./helpers/tenancy";

// Compile-time guard for #588: openEpisode must accept a transaction client
// directly, so the caller can keep the episode in its own transaction.
const openEpisodeInTransaction: (
	tx: Prisma.TransactionClient,
	input: EpisodeInput,
) => Promise<EpisodeResult> = openEpisode;
void openEpisodeInTransaction;

const WARNING_MESSAGE = "Feed hopper is running low — schedule a refill soon";
const CRITICAL_MESSAGE = "Feed hopper is nearly empty — refill immediately";

const INPUT = {
	pondId: "pond-1",
	category: "pellet" as const,
	episodeKey: pelletEpisodeKey("dev-1"),
	tier: "WARNING",
	message: WARNING_MESSAGE,
	linkTo: "/dashboard/settings",
};

function episodeStore() {
	return {
		notification: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
	};
}

function openNotifications(db: ReturnType<typeof createTenancyDb>) {
	return db.tables.notifications.filter(
		(row) =>
			row.episodeKey === INPUT.episodeKey &&
			row.resolvedAt === null &&
			row.autoCleared === false &&
			row.supersededById === null,
	);
}

describe("notification episodes (#534)", () => {
	let store: ReturnType<typeof episodeStore>;

	beforeEach(() => {
		store = episodeStore();
		store.notification.create.mockResolvedValue({ id: "notif-1" });
		store.notification.update.mockResolvedValue({});
		store.notification.updateMany.mockResolvedValue({ count: 1 });
	});

	it("keys each condition per device", () => {
		expect(pelletEpisodeKey("dev-1")).toBe("pellet:dev-1");
		expect(feedDaysEpisodeKey("dev-1")).toBe("pellet-days:dev-1");
		expect(offlineEpisodeKey("dev-1")).toBe("offline:dev-1");
		expect(coldWaterEpisodeKey("dev-1")).toBe("cold-water:dev-1");
	});

	it("opens one row when no episode is active", async () => {
		store.notification.findFirst.mockResolvedValue(null);

		const result = await openEpisode(store as never, {
			pondId: "pond-1",
			category: "pellet",
			episodeKey: pelletEpisodeKey("dev-1"),
			tier: "WARNING",
			message: WARNING_MESSAGE,
			linkTo: "/dashboard/settings",
		});

		expect(result).toEqual({ created: true, updated: false, id: "notif-1" });
		expect(store.notification.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					pondId: "pond-1",
					category: "pellet",
					tier: "WARNING",
					episodeKey: "pellet:dev-1",
				}),
			}),
		);
	});

	it("does not write when the same condition reports again", async () => {
		store.notification.findFirst.mockResolvedValue({
			id: "notif-1",
			tier: "WARNING",
			message: WARNING_MESSAGE,
		});

		const result = await openEpisode(store as never, {
			pondId: "pond-1",
			category: "pellet",
			episodeKey: pelletEpisodeKey("dev-1"),
			tier: "WARNING",
			message: WARNING_MESSAGE,
		});

		expect(result).toEqual({ created: false, updated: false, id: "notif-1" });
		expect(store.notification.create).not.toHaveBeenCalled();
		expect(store.notification.update).not.toHaveBeenCalled();
	});

	it("escalates an open episode in place", async () => {
		store.notification.findFirst.mockResolvedValue({
			id: "notif-1",
			tier: "WARNING",
			message: WARNING_MESSAGE,
		});

		const result = await openEpisode(store as never, {
			pondId: "pond-1",
			category: "pellet",
			episodeKey: pelletEpisodeKey("dev-1"),
			tier: "CRITICAL",
			message: CRITICAL_MESSAGE,
		});

		expect(result).toEqual({ created: false, updated: true, id: "notif-1" });
		expect(store.notification.update).toHaveBeenCalledWith({
			where: { id: "notif-1" },
			data: {
				tier: "CRITICAL",
				message: CRITICAL_MESSAGE,
				linkTo: null,
				read: false,
				// #747: an acknowledgement of the WARNING must not silence the
				// escalated CRITICAL alert.
				acknowledgedAt: null,
				acknowledgedBy: null,
			},
		});
		expect(store.notification.create).not.toHaveBeenCalled();
	});

	it("keeps the acknowledgement when the message is reworded without escalating", async () => {
		store.notification.findFirst.mockResolvedValue({
			id: "notif-1",
			tier: "WARNING",
			message: WARNING_MESSAGE,
		});

		await openEpisode(store as never, {
			pondId: "pond-1",
			category: "pellet",
			episodeKey: pelletEpisodeKey("dev-1"),
			tier: "WARNING",
			message: "Hopper low: about 8% left",
		});

		const data = store.notification.update.mock.calls[0][0].data;
		expect(data).not.toHaveProperty("acknowledgedAt");
		expect(data).not.toHaveProperty("acknowledgedBy");
	});

	it("only looks at rows that are still open", async () => {
		store.notification.findFirst.mockResolvedValue(null);

		await openEpisode(store as never, {
			pondId: "pond-1",
			category: "connectivity",
			episodeKey: offlineEpisodeKey("dev-1"),
			tier: "CRITICAL",
			message: "Feeder A is offline",
		});

		expect(store.notification.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					episodeKey: "offline:dev-1",
					resolvedAt: null,
					autoCleared: false,
					supersededById: null,
				},
			}),
		);
	});

	it("re-reads the winner and updates it when the insert loses the unique race", async () => {
		const findFirst = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "winner", tier: "WARNING", message: WARNING_MESSAGE });
		const create = vi
			.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
			);
		const update = vi.fn().mockResolvedValue({});
		const racingStore = {
			notification: { findFirst, create, update, updateMany: vi.fn() },
		};

		const result = await openEpisode(racingStore as never, {
			...INPUT,
			tier: "CRITICAL",
			message: CRITICAL_MESSAGE,
		});

		expect(result).toEqual({ created: false, updated: true, id: "winner" });
		expect(create).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith({
			where: { id: "winner" },
			data: {
				tier: "CRITICAL",
				message: CRITICAL_MESSAGE,
				linkTo: "/dashboard/settings",
				read: false,
				acknowledgedAt: null,
				acknowledgedBy: null,
			},
		});
	});

	it("does not swallow a create failure that is not a unique violation", async () => {
		store.notification.findFirst.mockResolvedValue(null);
		store.notification.create.mockRejectedValue(new Error("connection reset"));

		await expect(openEpisode(store as never, INPUT)).rejects.toThrow("connection reset");
	});

	it("closes every open row of the episode and keeps them readable", async () => {
		store.notification.updateMany.mockResolvedValue({ count: 2 });

		const closed = await closeEpisode(store as never, coldWaterEpisodeKey("dev-1"));

		expect(closed).toBe(2);
		const [call] = store.notification.updateMany.mock.calls;
		expect(call[0]).toMatchObject({
			where: { episodeKey: "cold-water:dev-1", resolvedAt: null, autoCleared: false },
			data: { autoCleared: true, read: true, resolutionReason: "condition_recovered" },
		});
		expect(call[0].data.resolvedAt).toBeInstanceOf(Date);
	});

	// #903: the heartbeat path resolves an episode on every beat where the
	// condition is absent. An unconditional updateMany there is a write per beat
	// that changes nothing, so it reads the open row first.
	it("resolves an open episode through the one open-row predicate", async () => {
		store.notification.findFirst.mockResolvedValue({ id: "notif-open" });
		store.notification.updateMany.mockResolvedValue({ count: 1 });

		const closed = await resolveEpisodeIfOpen(store as never, feedDaysEpisodeKey("dev-1"));

		expect(closed).toBe(1);
		expect(store.notification.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					episodeKey: "pellet-days:dev-1",
					resolvedAt: null,
					autoCleared: false,
					supersededById: null,
				},
			}),
		);
		expect(store.notification.updateMany).toHaveBeenCalledTimes(1);
	});

	it("issues no write when no episode is open", async () => {
		store.notification.findFirst.mockResolvedValue(null);

		const closed = await resolveEpisodeIfOpen(store as never, feedDaysEpisodeKey("dev-1"));

		expect(closed).toBe(0);
		expect(store.notification.updateMany).not.toHaveBeenCalled();
	});
});

describe("notification episode concurrency and transaction scope (#585)", () => {
	it("opens exactly one row when eight callers race for the same key", async () => {
		const db = createTenancyDb();

		const results = await Promise.all(
			Array.from({ length: 8 }, () => openEpisode(db.client as never, INPUT)),
		);

		const rows = openNotifications(db);
		expect(rows).toHaveLength(1);
		expect(new Set(results.map((result) => result.id))).toEqual(new Set([rows[0].id]));
		expect(results.filter((result) => result.created)).toHaveLength(1);
		expect(results.filter((result) => result.updated)).toHaveLength(0);
	});

	it("converges through the P2002 retry when the store cannot skip duplicates", async () => {
		const db = createTenancyDb();
		const { createMany: _createMany, ...notification } = db.client.notification;
		const store = { notification };

		const results = await Promise.all(
			Array.from({ length: 8 }, () => openEpisode(store as never, INPUT)),
		);

		const rows = openNotifications(db);
		expect(rows).toHaveLength(1);
		expect(new Set(results.map((result) => result.id))).toEqual(new Set([rows[0].id]));
		expect(results.filter((result) => result.created)).toHaveLength(1);
	});

	it("updates the existing row after an escalation instead of opening another", async () => {
		const db = createTenancyDb();

		const first = await openEpisode(db.client as never, INPUT);
		const second = await openEpisode(db.client as never, {
			...INPUT,
			tier: "CRITICAL",
			message: CRITICAL_MESSAGE,
		});

		expect(first.created).toBe(true);
		expect(second).toEqual({ created: false, updated: true, id: first.id });
		const rows = openNotifications(db);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ tier: "CRITICAL", message: CRITICAL_MESSAGE });
	});

	it("does its reads and writes through the transaction client the caller supplies", async () => {
		const db = createTenancyDb();
		const calls: string[] = [];
		const tx = Object.create(db.client) as typeof db.client;
		tx.notification = {
			...db.client.notification,
			findFirst: (...args: Parameters<typeof db.client.notification.findFirst>) => {
				calls.push("findFirst");
				return db.client.notification.findFirst(...args);
			},
			createMany: (...args: Parameters<typeof db.client.notification.createMany>) => {
				calls.push("createMany");
				return db.client.notification.createMany(...args);
			},
			create: (...args: Parameters<typeof db.client.notification.create>) => {
				calls.push("create");
				return db.client.notification.create(...args);
			},
			update: (...args: Parameters<typeof db.client.notification.update>) => {
				calls.push("update");
				return db.client.notification.update(...args);
			},
			updateMany: (...args: Parameters<typeof db.client.notification.updateMany>) => {
				calls.push("updateMany");
				return db.client.notification.updateMany(...args);
			},
		};

		const result = await db.runTransaction(() => openEpisode(tx as never, INPUT), tx);

		expect(result.created).toBe(true);
		expect(calls).toEqual(["findFirst", "createMany", "findFirst"]);
		expect(openNotifications(db)).toHaveLength(1);
	});
});
