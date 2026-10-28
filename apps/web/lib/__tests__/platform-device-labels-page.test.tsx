import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform/devices", () => ({ getPlatformDevicesForLabels: vi.fn() }));
vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));
vi.mock("@/i18n/routing", () => ({ Link: "a" }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));

// The page returns the shared DeviceLabelSheet, which needs next-intl and the
// routing Link; neither is what this test is about.
vi.mock("@/components/admin/device-label-sheet", () => ({
	DeviceLabelSheet: () => null,
}));

import PlatformDeviceLabelsPage from "@/app/[locale]/(print)/superadmin/devices/labels/page";
import { DeviceLabelEmptyState } from "@/components/admin/device-label-empty-state";
import { getPlatformDevicesForLabels } from "@/lib/actions/platform/devices";

const mockGetDevices = vi.mocked(getPlatformDevicesForLabels);

const devices = [
	{ id: "dev-a1", label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" },
	{ id: "dev-a2", label: "Feeder 2", mac: "a4:cf:12:7e:00:ff" },
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("platform device labels page", () => {
	it("answers not found when an explicitly requested device is unknown", async () => {
		mockGetDevices.mockResolvedValue([]);
		await expect(
			PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-b1" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mockGetDevices).toHaveBeenCalledWith(["dev-b1"]);
	});

	it("prints every platform device when no id is requested", async () => {
		mockGetDevices.mockResolvedValue(devices);

		const element = await PlatformDeviceLabelsPage({ searchParams: Promise.resolve({}) });

		expect(mockGetDevices).toHaveBeenCalledWith([]);
		expect(element.props).toEqual(
			expect.objectContaining({
				devices,
				backHref: "/superadmin/devices",
				searchParams: {},
			}),
		);
	});

	it("keeps the caller's selected ids, including a repeated parameter", async () => {
		mockGetDevices.mockResolvedValue(devices);
		await PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: ["a", "b"] }) });
		expect(mockGetDevices).toHaveBeenLastCalledWith(["a", "b"]);
	});

	it("renders an empty state instead of a 404 when the platform has no devices", async () => {
		mockGetDevices.mockResolvedValue([]);

		const element = await PlatformDeviceLabelsPage({ searchParams: Promise.resolve({}) });

		expect(element.type).toBe(DeviceLabelEmptyState);
		expect(element.props).toEqual({ backHref: "/superadmin/devices" });
	});

	it("renders the sheet for a device that is in scope", async () => {
		mockGetDevices.mockResolvedValue([devices[0]]);
		await expect(
			PlatformDeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-a1" }) }),
		).resolves.not.toThrow();
		expect(mockGetDevices).toHaveBeenCalledWith(["dev-a1"]);
	});
});
