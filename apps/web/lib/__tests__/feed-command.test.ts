import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
		},
		feedRequest: {
			findFirst: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceRateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET } from "@/app/api/feed-command/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockRateLimit = vi.mocked(checkDeviceRateLimit);

const DEVICE = {
	id: "dev-1",
	mac: "AA:BB:CC:DD:EE:FF",
	pondId: "pond-1",
	gramsPerFeeding: 150,
	buttonFeedGrams: 80,
	hopperEmptyCm: 30,
	hopperFullCm: 5,
	gramsPerSecond: 4,
	tempOffsetC: 0,
	tokenHash: hashToken("test-token"),
	approvalStatus: "APPROVED",
};

function pollRequest(token?: string): Request {
	const url = `http://test.local/api/feed-command?device_id=${DEVICE.mac}`;
	return new Request(url, {
		method: "GET",
		headers: token !== undefined ? { "x-device-token": token } : {},
	});
}

describe("GET /api/feed-command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimit.mockResolvedValue({ success: true } as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockFeedRequest.updateMany.mockResolvedValue({ count: 0 } as never);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		mockFeedRequest.update.mockResolvedValue({} as never);
	});

	it("returns 401 when the device token header is missing", async () => {
		const res = await GET(pollRequest(undefined));
		expect(res.status).toBe(401);
	});

	it("returns 422 when device_id is missing", async () => {
		const res = await GET(
			new Request("http://test.local/api/feed-command", {
				method: "GET",
				headers: { "x-device-token": "test-token" },
			}),
		);
		expect(res.status).toBe(422);
	});

	it("returns 429 when the device rate limit is exceeded", async () => {
		mockRateLimit.mockResolvedValue({ success: false } as never);
		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(429);
		expect(await res.text()).toBe("Too Many Requests");
		// Consumed only after verification and keyed on the verified mac.
		expect(mockRateLimit).toHaveBeenCalledTimes(1);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "feed");
		expect(mockFeedRequest.findFirst).not.toHaveBeenCalled();
	});

	it("returns 401 when the token does not resolve to a device", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		const res = await GET(pollRequest("wrong-token"));
		expect(res.status).toBe(401);
		// #330: an unverified token must not touch the named device's budget.
		expect(mockRateLimit).not.toHaveBeenCalled();
	});

	it("returns 401 when the token resolves to a different mac than device_id", async () => {
		const res = await GET(
			new Request("http://test.local/api/feed-command?device_id=11:22:33:44:55:66", {
				method: "GET",
				headers: { "x-device-token": "test-token" },
			}),
		);
		expect(res.status).toBe(401);
		// #330: naming another device's MAC with a valid token of your own does
		// not spend that device's bucket.
		expect(mockRateLimit).not.toHaveBeenCalled();
	});

	it("#330: an unauthenticated flood cannot exhaust a verified device's bucket", async () => {
		// Mirrors the real limiter's 20/min ceiling: before the fix, attacker
		// traffic keyed on the victim MAC pushed the counter past it and the
		// real device's next poll came back 429.
		let consumed = 0;
		mockRateLimit.mockImplementation(async () => {
			consumed += 1;
			return { success: consumed <= 20, remaining: Math.max(0, 20 - consumed) } as never;
		});

		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		for (let i = 0; i < 25; i += 1) {
			const res = await GET(pollRequest("attacker-token"));
			expect(res.status).toBe(401);
		}
		expect(mockRateLimit).not.toHaveBeenCalled();

		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(200);
		expect(mockRateLimit).toHaveBeenCalledTimes(1);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "feed");
	});

	it("returns an idle body when no request is pending", async () => {
		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.feed_requested).toBe(false);
		expect(body.feed_request_id).toBeNull();
		expect(body.grams).toBe(0);
		expect(body.grams_per_feeding).toBe(150);
		expect(mockRateLimit).toHaveBeenCalledWith(DEVICE.mac, "feed");
	});

	it("returns 403 for a PENDING device (org approval policy)", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({
			...DEVICE,
			approvalStatus: "PENDING",
		} as never);

		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(403);
		expect(mockFeedRequest.findFirst).not.toHaveBeenCalled();
	});

	it("marks stale pending requests expired before polling (lazy 60s expiry)", async () => {
		await GET(pollRequest("test-token"));
		expect(mockFeedRequest.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					deviceId: DEVICE.id,
					status: "pending",
					createdAt: { lt: expect.any(Date) },
				}),
				data: { status: "expired" },
			}),
		);
	});

	it("dispatches a pending request and clamps its grams", async () => {
		mockFeedRequest.findFirst.mockResolvedValue({
			id: "req-1",
			grams: 999_999,
			status: "pending",
			createdAt: new Date(),
		} as never);

		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.feed_requested).toBe(true);
		expect(body.feed_request_id).toBe("req-1");
		// Clamped to the 5,000 g payload sanity bound, not a feed cap.
		expect(body.grams).toBe(5000);
		expect(mockFeedRequest.update).toHaveBeenCalledWith({
			where: { id: "req-1" },
			data: { status: "dispatched" },
		});
	});

	it("returns safe idle defaults when the route throws", async () => {
		mockEnergyDevice.findUnique.mockRejectedValue(new Error("db down") as never);
		const res = await GET(pollRequest("test-token"));
		const body = await res.json();
		expect(body.feed_requested).toBe(false);
		expect(body.feed_request_id).toBeNull();
		expect(body.grams).toBe(0);
		// Hardcoded safe fallbacks so the ESP32 never hangs
		expect(body.grams_per_feeding).toBe(150);
		expect(body.grams_per_second).toBe(4.0);
	});
});
