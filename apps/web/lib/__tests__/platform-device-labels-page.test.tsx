import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform/devices", () => ({ getPlatformDevicesForLabels: vi.fn() }));
vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

// The page returns the shared DeviceLabelSheet, which needs next-intl and the
// routing Link; neither is what this test is about.
vi.mock("@/components/admin/device-label-sheet", () => ({
	DeviceLabelSheet: () => null,
}));

import PlatformDeviceLabelsPage from "@/app/[locale]/(print)/superadmin/devices/labels/page";
import { getPlatformDevicesForLabels } from "@/lib/actions/platform/devices";

const mockGetDevices = vi.mocked(getPlatformDevicesForLabels);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("platform device labels page", () => {
	it("answers not found when no requested device is on the platform", async () => {
		mockGetDevices.mockResolvedValue([]);
		await expect(
			PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-b1" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("accepts one id, a repeated id parameter, or none", async () => {
		mockGetDevices.mockResolvedValue([]);
		await expect(
			PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: ["a", "b"] }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mockGetDevices).toHaveBeenLastCalledWith(["a", "b"]);

		await expect(PlatformDeviceLabelsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
			"NEXT_NOT_FOUND",
		);
		expect(mockGetDevices).toHaveBeenLastCalledWith([]);
	});

	it("renders the sheet for a device that is in scope", async () => {
		mockGetDevices.mockResolvedValue([
			{ id: "dev-a1", label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" },
		]);
		await expect(
			PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-a1" }) }),
		).resolves.not.toThrow();
		expect(mockGetDevices).toHaveBeenCalledWith(["dev-a1"]);
	});
});
