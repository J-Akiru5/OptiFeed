import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	deviceFindMany: vi.fn(),
	otaFindMany: vi.fn(),
	gate: vi.fn(),
	channel: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findMany: mocks.deviceFindMany },
		deviceStateEvent: { findMany: mocks.otaFindMany },
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

vi.mock("@/lib/settings/firmware-status", () => ({
	getFirmwareStatus: mocks.channel,
}));

import {
	countVersions,
	getFirmwareFleet,
	latestOtaByDevice,
	versionFromMetadata,
} from "@/lib/platform/firmware";

const NOW = new Date("2026-10-27T12:00:00.000Z");

const channel = {
	storageConfigured: true,
	channelPath: "channels/stable.json",
	channelVersion: "1.4.1",
	channelAvailable: true,
	windowStart: "10:00",
	windowEnd: "15:00",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.channel.mockResolvedValue(channel);

	mocks.deviceFindMany.mockResolvedValue([
		{
			id: "dev-a",
			label: "Alpha",
			mac: "AA:AA",
			lastSeenAt: new Date("2026-10-27T11:58:00.000Z"),
			pond: { name: "Pond A" },
		},
		{
			id: "dev-b",
			label: "Bravo",
			mac: "BB:BB",
			lastSeenAt: null,
			pond: null,
		},
	]);

	// Newest first: one row per device that has reported an OTA state.
	mocks.otaFindMany
		.mockResolvedValueOnce([
			{
				deviceId: "dev-a",
				eventType: "ota_valid",
				metadata: { version: "1.4.1", state: "valid" },
				createdAt: new Date("2026-10-27T10:00:00.000Z"),
			},
			{
				deviceId: "dev-a",
				eventType: "ota_installed",
				metadata: { version: "1.4.0" },
				createdAt: new Date("2026-10-20T10:00:00.000Z"),
			},
		])
		.mockResolvedValueOnce([
			{
				id: "ota-1",
				deviceId: "dev-a",
				eventType: "ota_valid",
				metadata: { version: "1.4.1" },
				createdAt: new Date("2026-10-27T10:00:00.000Z"),
				device: { label: "Alpha" },
			},
		]);
});

describe("versionFromMetadata", () => {
	it("reads a trimmed version string", () => {
		expect(versionFromMetadata({ version: "1.4.1" })).toBe("1.4.1");
		expect(versionFromMetadata({ version: "  1.4.1 " })).toBe("1.4.1");
	});

	it("rejects missing, non-string, empty and oversized values", () => {
		expect(versionFromMetadata(null)).toBeNull();
		expect(versionFromMetadata({})).toBeNull();
		expect(versionFromMetadata({ version: 141 })).toBeNull();
		expect(versionFromMetadata({ version: "   " })).toBeNull();
		expect(versionFromMetadata({ version: "x".repeat(33) })).toBeNull();
	});
});

describe("latestOtaByDevice", () => {
	it("keeps the first (newest) row per device", () => {
		const latest = latestOtaByDevice([
			{
				deviceId: "dev-a",
				eventType: "ota_valid",
				metadata: { version: "1.4.1" },
				createdAt: new Date("2026-10-27T10:00:00.000Z"),
			},
			{
				deviceId: "dev-a",
				eventType: "ota_installed",
				metadata: { version: "1.4.0" },
				createdAt: new Date("2026-10-20T10:00:00.000Z"),
			},
		]);

		expect(latest.get("dev-a")).toEqual({
			version: "1.4.1",
			eventType: "ota_valid",
			createdAt: new Date("2026-10-27T10:00:00.000Z"),
		});
	});

	it("records the event even when the row carries no version", () => {
		const latest = latestOtaByDevice([
			{
				deviceId: "dev-b",
				eventType: "ota_installed",
				metadata: {},
				createdAt: new Date("2026-10-27T09:00:00.000Z"),
			},
		]);

		expect(latest.get("dev-b")).toMatchObject({
			version: null,
			eventType: "ota_installed",
		});
	});
});

describe("countVersions", () => {
	it("counts known versions and reports unknown separately", () => {
		expect(
			countVersions([
				{ reportedVersion: "1.4.1" },
				{ reportedVersion: "1.4.1" },
				{ reportedVersion: "1.4.0" },
				{ reportedVersion: null },
			]),
		).toEqual({
			versionCounts: [
				{ version: "1.4.1", count: 2 },
				{ version: "1.4.0", count: 1 },
			],
			unknownCount: 1,
		});
	});
});

describe("getFirmwareFleet", () => {
	it("requires a platform admin before any read", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(getFirmwareFleet(NOW)).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.deviceFindMany).not.toHaveBeenCalled();
		expect(mocks.otaFindMany).not.toHaveBeenCalled();
	});

	it("maps each device to its reported version and the channel status", async () => {
		const fleet = await getFirmwareFleet(NOW);

		expect(fleet.channel).toBe(channel);
		expect(fleet.devices).toEqual([
			expect.objectContaining({
				id: "dev-a",
				reportedVersion: "1.4.1",
				online: true,
				pondName: "Pond A",
				versionEvent: {
					eventType: "ota_valid",
					createdAt: new Date("2026-10-27T10:00:00.000Z"),
				},
			}),
			expect.objectContaining({
				id: "dev-b",
				reportedVersion: null,
				online: false,
				versionEvent: null,
			}),
		]);
		expect(fleet.versionCounts).toEqual([{ version: "1.4.1", count: 1 }]);
		expect(fleet.unknownCount).toBe(1);
		expect(fleet.otaEvents).toEqual([
			expect.objectContaining({
				id: "ota-1",
				deviceLabel: "Alpha",
				eventType: "ota_valid",
				version: "1.4.1",
			}),
		]);
	});
});
