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
	};
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
			},
		});
		expect(store.notification.create).not.toHaveBeenCalled();
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
});
