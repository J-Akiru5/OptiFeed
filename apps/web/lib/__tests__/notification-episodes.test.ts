import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	closeEpisode,
	coldWaterEpisodeKey,
	feedDaysEpisodeKey,
	offlineEpisodeKey,
	openEpisode,
	pelletEpisodeKey,
} from "@/lib/notifications/episodes";

const WARNING_MESSAGE = "Feed hopper is running low — schedule a refill soon";
const CRITICAL_MESSAGE = "Feed hopper is nearly empty — refill immediately";

function episodeStore() {
	return {
		notification: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		$queryRaw: vi.fn(),
	};
}

describe("notification episodes (#534)", () => {
	let store: ReturnType<typeof episodeStore>;

	beforeEach(() => {
		store = episodeStore();
		store.$queryRaw.mockResolvedValue([{ id: "notif-1" }]);
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
		expect(store.$queryRaw).toHaveBeenCalledTimes(1);
		const [, id, pondId, tier, category, message, linkTo, episodeKey] =
			store.$queryRaw.mock.calls[0];
		expect(typeof id).toBe("string");
		expect([pondId, tier, category, message, linkTo, episodeKey]).toEqual([
			"pond-1",
			"WARNING",
			"pellet",
			WARNING_MESSAGE,
			"/dashboard/settings",
			"pellet:dev-1",
		]);
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
		expect(store.$queryRaw).not.toHaveBeenCalled();
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
			},
		});
		expect(store.notification.create).not.toHaveBeenCalled();
		expect(store.$queryRaw).not.toHaveBeenCalled();
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
				where: { episodeKey: "offline:dev-1", resolvedAt: null, autoCleared: false },
			}),
		);
	});

	it("closes every open row of the episode and keeps them readable", async () => {
		store.notification.updateMany.mockResolvedValue({ count: 2 });

		const closed = await closeEpisode(store as never, coldWaterEpisodeKey("dev-1"));

		expect(closed).toBe(2);
		const [call] = store.notification.updateMany.mock.calls;
		expect(call[0]).toMatchObject({
			where: { episodeKey: "cold-water:dev-1", resolvedAt: null, autoCleared: false },
			data: { autoCleared: true, read: true },
		});
		expect(call[0].data.resolvedAt).toBeInstanceOf(Date);
	});

	it("converges concurrent openEpisode calls on one row when the unique index rejects the loser", async () => {
		let openRow: { id: string; tier: string; message: string } | null = null;
		let inserts = 0;
		const concurrent = {
			notification: {
				findFirst: vi.fn(async () => openRow),
				update: vi.fn(async () => ({})),
				updateMany: vi.fn(),
			},
			$queryRaw: vi.fn(async () => {
				if (openRow) return [];
				openRow = { id: "notif-1", tier: "WARNING", message: WARNING_MESSAGE };
				inserts += 1;
				return [{ id: "notif-1" }];
			}),
		};

		const input = {
			pondId: "pond-1",
			category: "pellet" as const,
			episodeKey: pelletEpisodeKey("dev-1"),
			tier: "WARNING",
			message: WARNING_MESSAGE,
		};
		const [first, second] = await Promise.all([
			openEpisode(concurrent as never, input),
			openEpisode(concurrent as never, input),
		]);

		expect(inserts).toBe(1);
		expect([first.id, second.id]).toEqual(["notif-1", "notif-1"]);
		expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
		expect(concurrent.$queryRaw).toHaveBeenCalledTimes(2);
		expect(concurrent.notification.update).not.toHaveBeenCalled();
	});

	it("rethrows an insert failure that is not a unique conflict", async () => {
		store.notification.findFirst.mockResolvedValue(null);
		store.$queryRaw.mockRejectedValue(new Error("db down"));

		await expect(
			openEpisode(store as never, {
				pondId: "pond-1",
				category: "pellet",
				episodeKey: pelletEpisodeKey("dev-1"),
				tier: "WARNING",
				message: WARNING_MESSAGE,
			}),
		).rejects.toThrow("db down");
	});
});
