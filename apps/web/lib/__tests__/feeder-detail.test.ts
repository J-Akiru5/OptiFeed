import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	getCurrentPondOwnerIdSafe: vi.fn(),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findMany: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		feedEvent: { findFirst: vi.fn() },
	},
}));

import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import { getDeviceDetail } from "@/lib/feeder/detail";
import prisma from "@/lib/prisma";

const ADMIN = { id: "admin-1", role: "ADMIN" } as never;
const OPERATOR = { id: "operator-1", role: "OPERATOR" } as never;
const NOW = new Date("2026-10-29T10:00:00+08:00");

const DEVICE = {
	id: "dev-1",
	label: "CICT Building A Feeder",
	mac: "68:09:47:25:E1:80",
	lastSeenAt: new Date("2026-10-29T09:59:00+08:00"),
	rtcOk: true,
	isPaused: false,
	feedLevelPercent: 30,
	hopperCapacityG: 22_190,
	gramsPerFeeding: 150,
	pond: { id: "pond-a", name: "Demo Pond" },
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(resolveOrgScope).mockResolvedValue({ pondIds: [] } as never);
	vi.mocked(getCurrentPondOwnerIdSafe).mockResolvedValue("farm-a");
	vi.mocked(prisma.energyDevice.findFirst).mockResolvedValue(DEVICE as never);
	vi.mocked(prisma.feedEvent.findFirst).mockResolvedValue(null);
});

describe("getDeviceDetail", () => {
	it("uses the organization scope for a tenant admin", async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(ADMIN);
		vi.mocked(resolveOrgScope).mockResolvedValue({ pondIds: ["pond-a"] } as never);

		const detail = await getDeviceDetail("dev-1", NOW);

		expect(prisma.energyDevice.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "dev-1", pondId: { in: ["pond-a"] } } }),
		);
		expect(detail).toMatchObject({
			id: "dev-1",
			status: "idle",
			pond: { id: "pond-a" },
		});
	});

	it("uses the caller's active ponds for a farmer", async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(OPERATOR);
		vi.mocked(getCurrentPondOwnerIdSafe).mockResolvedValue("farm-a");
		vi.mocked(prisma.pond.findMany).mockResolvedValue([{ id: "pond-a" }] as never);

		await getDeviceDetail("dev-1", NOW);

		expect(prisma.pond.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { ownerId: "farm-a", status: "ACTIVE" } }),
		);
		expect(prisma.energyDevice.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "dev-1", pondId: { in: ["pond-a"] } } }),
		);
	});

	it("returns null for an out-of-scope or unknown device", async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(OPERATOR);
		vi.mocked(getCurrentPondOwnerIdSafe).mockResolvedValue("farm-a");
		vi.mocked(prisma.pond.findMany).mockResolvedValue([{ id: "pond-a" }] as never);
		vi.mocked(prisma.energyDevice.findFirst).mockResolvedValue(null);

		await expect(getDeviceDetail("dev-foreign")).resolves.toBeNull();
	});

	it("returns null without querying when there is no session", async () => {
		vi.mocked(getCurrentUser).mockResolvedValue(null);

		await expect(getDeviceDetail("dev-1", NOW)).resolves.toBeNull();
		expect(prisma.energyDevice.findFirst).not.toHaveBeenCalled();
	});
});
