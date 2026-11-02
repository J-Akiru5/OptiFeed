import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #670: two overlapping device polls must not both dispatch the same pending
 * request. The claim is a compare-and-set, and only the winner gets a request.
 */

const { db } = vi.hoisted(() => ({
	db: { feedRequest: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { claimPendingFeedRequest } from "@/lib/feed/commands";

const ROW = {
	id: "fr-1",
	deviceId: "dev-1",
	status: "pending",
	grams: 100,
	kind: "manual",
};

beforeEach(() => {
	vi.clearAllMocks();
	db.feedRequest.findFirst.mockResolvedValue(ROW);
	db.feedRequest.updateMany.mockResolvedValue({ count: 1 });
});

describe("claimPendingFeedRequest", () => {
	it("claims the head with a status-guarded update", async () => {
		const claim = await claimPendingFeedRequest(db as never, "dev-1");

		expect(claim).toEqual({ status: "claimed", request: ROW });
		expect(db.feedRequest.updateMany).toHaveBeenCalledWith({
			where: { id: "fr-1", status: "pending" },
			data: { status: "dispatched" },
		});
	});

	it("reports a lost race when the row was already claimed", async () => {
		db.feedRequest.updateMany.mockResolvedValue({ count: 0 });

		expect(await claimPendingFeedRequest(db as never, "dev-1")).toEqual({ status: "lost" });
	});

	it("reports empty when nothing is pending, without an update", async () => {
		db.feedRequest.findFirst.mockResolvedValue(null);

		expect(await claimPendingFeedRequest(db as never, "dev-1")).toEqual({ status: "empty" });
		expect(db.feedRequest.updateMany).not.toHaveBeenCalled();
	});

	it("gives the request to exactly one of two concurrent claims", async () => {
		let updates = 0;
		db.feedRequest.updateMany.mockImplementation(async () => {
			updates += 1;
			return { count: updates === 1 ? 1 : 0 };
		});

		const [first, second] = await Promise.all([
			claimPendingFeedRequest(db as never, "dev-1"),
			claimPendingFeedRequest(db as never, "dev-1"),
		]);

		expect([first.status, second.status].sort()).toEqual(["claimed", "lost"]);
		expect([first, second].filter((claim) => claim.status === "claimed")).toHaveLength(1);
	});
});
