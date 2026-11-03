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
		// I-100: the poll now reads the platform setting rows for the firmware
		// config (feeding caps, firmware gates, device connectivity). A null row
		// means "use the defaults", which is what these tests assert.
		platformSetting: {
			findUnique: vi.fn().mockResolvedValue(null),
		},
		// #456: the poll resolves the org hopper threshold through the same chain
		// as ingest — device pond -> farm owner -> active organization -> row.
		pond: { findUnique: vi.fn() },
		user: { findMany: vi.fn() },
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		orgSetting: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceRateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET } from "@/app/api/feed-command/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";
import { clearOrgHopperCache } from "@/lib/settings/org-hopper";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockFeedRequest = vi.mocked(prisma.feedRequest);
const mockRateLimit = vi.mocked(checkDeviceRateLimit);
const mockPlatformSetting = vi.mocked(prisma.platformSetting);
const mockPond = vi.mocked(prisma.pond);
const mockUser = vi.mocked(prisma.user);
const mockMembership = vi.mocked(prisma.membership);
const mockOrganization = vi.mocked(prisma.organization);
const mockOrgSetting = vi.mocked(prisma.orgSetting);

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
		clearOrgHopperCache();
		vi.clearAllMocks();
		mockRateLimit.mockResolvedValue({ success: true } as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		// The first `updateMany` is the lazy-expiry sweep (no `id`); the second is
		// the claim (#670), which does carry the request id and must win here.
		mockFeedRequest.updateMany.mockImplementation((async (args: { where?: { id?: string } }) => ({
			count: args?.where?.id ? 1 : 0,
		})) as never);
		mockFeedRequest.findFirst.mockResolvedValue(null);
		mockFeedRequest.update.mockResolvedValue({} as never);
		// Reset the platform reads too: `clearAllMocks` keeps implementations, and
		// one test below overrides them.
		mockPlatformSetting.findUnique.mockResolvedValue(null);
		// A resolvable pond -> farmer -> active org with no OrgSetting row, i.e.
		// the schema default of 20 % applies.
		mockPond.findUnique.mockResolvedValue({ ownerId: "farm-1" } as never);
		mockUser.findMany.mockResolvedValue([{ id: "user-1", farmId: "farm-1" }] as never);
		mockMembership.findMany.mockResolvedValue([{ userId: "user-1", orgId: "org-1" }] as never);
		mockOrganization.findMany.mockResolvedValue([{ id: "org-1" }] as never);
		mockOrgSetting.findMany.mockResolvedValue([] as never);
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

	it("sends the 1.7.0 config object with a stable revision (I-100)", async () => {
		const first = await (await GET(pollRequest("test-token"))).json();
		const second = await (await GET(pollRequest("test-token"))).json();

		expect(first.config).toMatchObject({
			version: 1,
			min_dispense_gap_s: 10,
			max_dispenses_per_hour: 6,
			max_grams_per_day: 2000,
			grams_per_feeding: 150,
			button_feed_grams: 80,
			grams_per_second: 4,
			hopper_full_cm: 5,
			hopper_empty_cm: 30,
			heartbeat_interval_s: 5,
		});
		expect(typeof first.config.rev).toBe("number");
		expect(first.config.rev).toBe(second.config.rev);
		// The legacy flat fields stay for firmware <= 1.6.x.
		expect(first.grams_per_feeding).toBe(150);
	});

	it("caps the config daily ceiling by the device and the platform", async () => {
		const platformSetting = vi.mocked(prisma.platformSetting);
		platformSetting.findUnique.mockImplementation((async (args: { where: { key: string } }) => {
			if (args.where.key === "feeding.limits") {
				return { value: { maxDispenseMs: 120_000, dailyCapFactor: 0.5 } };
			}
			if (args.where.key === "firmware.gates") {
				return { value: { min_dispense_gap_s: 30, max_dispenses_per_hour: 3 } };
			}
			return null;
		}) as never);

		const body = await (await GET(pollRequest("test-token"))).json();
		expect(body.config.max_dispense_ms).toBe(120_000);
		// 2,000 g default device cap x 0.5 platform factor.
		expect(body.config.max_grams_per_day).toBe(1000);
		expect(body.config.min_dispense_gap_s).toBe(30);
		expect(body.config.max_dispenses_per_hour).toBe(3);
	});

	it("#456: sends the organization hopper threshold in the idle poll", async () => {
		mockOrgSetting.findMany.mockResolvedValue([{ orgId: "org-1", hopperLowPct: 30 }] as never);

		const body = await (await GET(pollRequest("test-token"))).json();
		expect(body.config.hopper_low_pct).toBe(30);
		// Device -> pond -> farm owner, the same chain ingest uses.
		expect(mockPond.findUnique).toHaveBeenCalledWith({
			where: { id: DEVICE.pondId },
			select: { ownerId: true },
		});
	});

	it("#456: sends the organization hopper threshold with a dispatched feed", async () => {
		mockOrgSetting.findMany.mockResolvedValue([{ orgId: "org-1", hopperLowPct: 30 }] as never);
		mockFeedRequest.findFirst.mockResolvedValue({
			id: "req-1",
			grams: 120,
			kind: "feed",
			status: "pending",
			createdAt: new Date(),
		} as never);

		const body = await (await GET(pollRequest("test-token"))).json();
		expect(body.feed_requested).toBe(true);
		expect(body.config.hopper_low_pct).toBe(30);
	});

	it("#456: an unreadable org row still returns 200 with a full config at 20", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mockOrgSetting.findMany.mockRejectedValue(new Error("db down") as never);

		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(200);
		const body = await res.json();
		// The route catch drops `config` entirely; the helper's own fallback must
		// keep the poll answering with the full object at the schema default.
		expect(body.feed_requested).toBe(false);
		expect(body.config).toMatchObject({
			version: 1,
			hopper_low_pct: 20,
			grams_per_feeding: 150,
			max_grams_per_day: 2000,
		});
		expect(typeof body.config.rev).toBe("number");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("[org-hopper]"), expect.any(Error));
		warn.mockRestore();
	});

	it("#456: a device with no pond gets the default threshold", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE, pondId: null } as never);

		const res = await GET(pollRequest("test-token"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.config.hopper_low_pct).toBe(20);
		// No pond means no org query at all.
		expect(mockPond.findUnique).not.toHaveBeenCalled();
	});

	it("#456: caches the resolved threshold per device within the 60 s TTL", async () => {
		clearOrgHopperCache();
		mockOrgSetting.findMany.mockResolvedValue([{ orgId: "org-1", hopperLowPct: 30 }] as never);
		const first = await (await GET(pollRequest("test-token"))).json();
		expect(first.config.hopper_low_pct).toBe(30);

		// The row changes, but the memoized value answers until the TTL expires.
		mockOrgSetting.findMany.mockResolvedValue([{ orgId: "org-1", hopperLowPct: 45 }] as never);
		const second = await (await GET(pollRequest("test-token"))).json();
		expect(second.config.hopper_low_pct).toBe(30);
		expect(mockPond.findUnique).toHaveBeenCalledTimes(1);
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
		// #670: the claim is a status-guarded update, not an update by id alone.
		expect(mockFeedRequest.updateMany).toHaveBeenCalledWith({
			where: { id: "req-1", status: "pending" },
			data: { status: "dispatched" },
		});
	});

	it("returns 503 with Retry-After when the route throws (#724)", async () => {
		mockEnergyDevice.findUnique.mockRejectedValue(new Error("db down") as never);

		const res = await GET(pollRequest("test-token"));

		// The old 200 idle body made the firmware believe the poll succeeded and
		// stop retrying, so the pending feed expired undelivered.
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("5");
		expect(await res.text()).toBe("Service Unavailable");
		expect(mockFeedRequest.updateMany).not.toHaveBeenCalled();
	});

	it("#724: a failure while claiming leaves the pending request unmutated", async () => {
		// Verification and config succeed; the claim read then fails. No row may
		// be marked dispatched, so the next poll can still deliver the feed.
		mockFeedRequest.findFirst.mockRejectedValue(new Error("db down") as never);

		const res = await GET(pollRequest("test-token"));

		expect(res.status).toBe(503);
		const dispatchedWrites = mockFeedRequest.updateMany.mock.calls.filter(
			([arg]) => (arg as { data?: { status?: string } }).data?.status === "dispatched",
		);
		expect(dispatchedWrites).toHaveLength(0);
	});

	it("#724: an empty queue still returns 200 idle", async () => {
		const res = await GET(pollRequest("test-token"));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.feed_requested).toBe(false);
		expect(body.feed_request_id).toBeNull();
	});
});
