import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/admin", () => ({ getDevicesForLabels: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ Link: "a" }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));
// The page returns the shared sheet; these are the sheet's own dependencies and
// are not what this test exercises.
vi.mock("@/lib/auth/require-platform-admin", () => ({ isCurrentPlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/tenant-admin", () => ({ getTenantAdminState: vi.fn() }));
vi.mock("@/lib/settings/sticker-rating", () => ({ getStickerRatingDefault: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import DeviceLabelsPage from "@/app/[locale]/(print)/admin/devices/labels/page";
import { DeviceLabelEmptyState } from "@/components/admin/device-label-empty-state";
import { getDevicesForLabels } from "@/lib/actions/admin";

const mockGetDevicesForLabels = vi.mocked(getDevicesForLabels);

const devices = [
	{ id: "dev-a1", label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" },
	{ id: "dev-a2", label: "Feeder 2", mac: "a4:cf:12:7e:00:ff" },
];

beforeEach(() => {
	vi.clearAllMocks();
});

describe("device labels page", () => {
	it("answers not found when an explicitly requested device is out of scope", async () => {
		mockGetDevicesForLabels.mockResolvedValue([]);
		await expect(
			DeviceLabelsPage({ searchParams: Promise.resolve({ id: "dev-b1" }) }),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mockGetDevicesForLabels).toHaveBeenCalledWith(["dev-b1"]);
	});

	it("prints every device in scope when no id is requested", async () => {
		mockGetDevicesForLabels.mockResolvedValue(devices);

		const element = await DeviceLabelsPage({ searchParams: Promise.resolve({}) });

		expect(mockGetDevicesForLabels).toHaveBeenCalledWith([]);
		expect(element.props).toEqual(
			expect.objectContaining({
				devices,
				backHref: "/admin/devices",
				searchParams: {},
			}),
		);
	});

	it("keeps the caller's selected ids, including a repeated parameter", async () => {
		mockGetDevicesForLabels.mockResolvedValue(devices);
		await DeviceLabelsPage({ searchParams: Promise.resolve({ id: ["a", "b"] }) });
		expect(mockGetDevicesForLabels).toHaveBeenLastCalledWith(["a", "b"]);
	});

	it("renders an empty state instead of a 404 when the scope has no devices", async () => {
		mockGetDevicesForLabels.mockResolvedValue([]);

		const element = await DeviceLabelsPage({ searchParams: Promise.resolve({}) });

		expect(element.type).toBe(DeviceLabelEmptyState);
		expect(element.props).toEqual({ backHref: "/admin/devices" });
	});

	it("passes the per-print rating params through to the sheet", async () => {
		mockGetDevicesForLabels.mockResolvedValue([devices[0]]);
		const searchParams = { id: "dev-a1", voltage: "230", hz: "50", measured: "1" };

		const element = await DeviceLabelsPage({ searchParams: Promise.resolve(searchParams) });

		expect(element.props).toEqual(
			expect.objectContaining({
				devices: [devices[0]],
				backHref: "/admin/devices",
				searchParams,
			}),
		);
	});
});
