import { beforeEach, describe, expect, it, vi } from "vitest";

// Two tenants share the fake table. Org A has pond-a in scope; the device on
// pond-b belongs to another org. Every row carries credentials that must never
// reach a sticker.
const TOKEN = "tok_SECRET_do_not_print_0123456789";
const TOKEN_HASH = "hash_SECRET_do_not_print_abcdef";

const { findMany } = vi.hoisted(() => {
	const rows = [
		{
			id: "dev-a1",
			label: "Feeder 1",
			mac: "A4:CF:12:7E:3B:09",
			pondId: "pond-a",
			token: "tok_SECRET_do_not_print_0123456789",
			tokenHash: "hash_SECRET_do_not_print_abcdef",
		},
		{
			id: "dev-a2",
			label: "Feeder 2",
			mac: "a4:cf:12:7e:00:ff",
			pondId: "pond-a",
			token: "tok_SECRET_do_not_print_0123456789-2",
			tokenHash: "hash_SECRET_do_not_print_abcdef-2",
		},
		{
			id: "dev-b1",
			label: "Other org feeder",
			mac: "11:22:33:44:55:66",
			pondId: "pond-b",
			token: "tok_SECRET_do_not_print_0123456789-b",
			tokenHash: "hash_SECRET_do_not_print_abcdef-b",
		},
	];
	type Args = {
		where: { id: { in: string[] }; pondId: { in: string[] } };
		select: Record<string, true>;
	};
	const findMany = vi.fn(async (args: Args) =>
		rows
			.filter((r) => args.where.id.in.includes(r.id) && args.where.pondId.in.includes(r.pondId))
			.map((r) =>
				Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k as keyof typeof r]])),
			),
	);
	return { findMany };
});

vi.mock("@/lib/prisma", () => ({ default: { energyDevice: { findMany } } }));
vi.mock("@/lib/auth/tenant-admin", () => ({ requireTenantAdmin: vi.fn() }));
vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ buildPondEmail: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));
vi.mock("@/lib/auth/password", () => ({
	passwordErrorMessage: vi.fn(),
	validatePassword: vi.fn(),
}));
vi.mock("@/lib/auth/permissions", () => ({
	ROLE_DEFAULTS: {},
	isPermission: vi.fn(),
	requirePermission: vi.fn(),
}));
vi.mock("@/lib/actions/admin-internal", () => ({ deleteUserSubtree: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));

import { DeviceSticker, type DeviceStickerStrings } from "@/components/admin/device-sticker";
import { getDevicesForLabels } from "@/lib/actions/admin";
import { resolveOrgScope } from "@/lib/auth/org-scope";
import { requireTenantAdmin } from "@/lib/auth/tenant-admin";
import { provisioningApSsid, wifiSetupPayload } from "@/lib/provisioning-ap";
import { renderToStaticMarkup } from "react-dom/server";

const mockRequireTenantAdmin = vi.mocked(requireTenantAdmin);
const mockResolveOrgScope = vi.mocked(resolveOrgScope);

const orgAScope = {
	orgIds: ["org-a"],
	memberUserIds: ["u-a"],
	farmIds: ["f-a"],
	pondIds: ["pond-a"],
};

const strings: DeviceStickerStrings = {
	subtitle: "Precision Feeder Unit",
	tag: "{type} input only",
	tagAc: "AC input",
	sectionRating: "Power rating",
	input: "Input",
	current: "Current",
	power: "Power",
	max: "max",
	unitId: "Unit ID",
	stepScan: "Scan the QR and join {ssid}",
	stepPortal: "Open {address} if the page does not appear",
	stepSave: "Enter farm Wi-Fi and device details, then Save",
	noteTitle: "No setup network showing?",
	noteBody: "Hold the Wi-Fi reset button for 5 s to reopen setup.",
	scan: "Scan to set up Wi-Fi",
	qrLabel: "Wi-Fi setup QR code",
	footerSupply: "{type} supply only",
	footerUnplug: "Unplug before servicing",
	footerDry: "Keep dry",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireTenantAdmin.mockResolvedValue(undefined);
	mockResolveOrgScope.mockResolvedValue(orgAScope);
});

describe("getDevicesForLabels access", () => {
	it("returns an in-scope device with display fields only", async () => {
		const result = await getDevicesForLabels(["dev-a1"]);
		expect(result).toEqual([{ id: "dev-a1", label: "Feeder 1", mac: "A4:CF:12:7E:3B:09" }]);
	});

	it("applies the tenant gate before touching the database", async () => {
		mockRequireTenantAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(getDevicesForLabels(["dev-a1"])).rejects.toThrow("NEXT_REDIRECT");
		expect(findMany).not.toHaveBeenCalled();
		expect(mockResolveOrgScope).not.toHaveBeenCalled();
	});

	it("scopes the query to the pond ids in the caller's org scope", async () => {
		await getDevicesForLabels(["dev-a1", "dev-a2"]);
		expect(findMany).toHaveBeenCalledTimes(1);
		expect(findMany.mock.calls[0][0].where.pondId).toEqual({ in: orgAScope.pondIds });
	});

	it("treats a device from another org as not found", async () => {
		expect(await getDevicesForLabels(["dev-b1"])).toEqual([]);
	});

	it("drops the out-of-scope device from a mixed selection without revealing it", async () => {
		const result = await getDevicesForLabels(["dev-a1", "dev-b1", "dev-a2"]);
		expect(result.map((d) => d.id)).toEqual(["dev-a1", "dev-a2"]);
		expect(JSON.stringify(result)).not.toContain("11:22:33:44:55:66");
		expect(JSON.stringify(result)).not.toContain("Other org feeder");
	});

	it("returns nothing for a caller with an empty scope", async () => {
		mockResolveOrgScope.mockResolvedValue({
			orgIds: [],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
		});
		expect(await getDevicesForLabels(["dev-a1", "dev-b1"])).toEqual([]);
	});

	it("ignores blank ids and does not query for an empty selection", async () => {
		expect(await getDevicesForLabels([])).toEqual([]);
		expect(await getDevicesForLabels(["", "  "])).toEqual([]);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("keeps the selected order and de-duplicates", async () => {
		const result = await getDevicesForLabels(["dev-a2", "dev-a1", "dev-a2"]);
		expect(result.map((d) => d.id)).toEqual(["dev-a2", "dev-a1"]);
	});
});

describe("sticker never carries a credential", () => {
	it("does not select token or tokenHash", async () => {
		await getDevicesForLabels(["dev-a1"]);
		const { select } = findMany.mock.calls[0][0];
		expect(Object.keys(select).sort()).toEqual(["id", "label", "mac"]);
		expect(select).not.toHaveProperty("token");
		expect(select).not.toHaveProperty("tokenHash");
	});

	it("renders no token, hash or credential into the sticker markup", async () => {
		const devices = await getDevicesForLabels(["dev-a1", "dev-a2"]);
		const html = devices
			.map((d) => renderToStaticMarkup(<DeviceSticker mac={d.mac} strings={strings} />))
			.join("\n");

		for (const secret of [TOKEN, TOKEN_HASH, "SECRET", "tokenHash"]) {
			expect(html).not.toContain(secret);
		}
		expect(html).toContain("PakaonAI-3B09");
		expect(html).toContain("PakaonAI-00FF");
	});

	it("ignores a token passed to the component by mistake", () => {
		const leaky = { mac: "A4:CF:12:7E:3B:09", strings, token: TOKEN, tokenHash: TOKEN_HASH };
		const html = renderToStaticMarkup(<DeviceSticker {...leaky} />);
		expect(html).not.toContain(TOKEN);
		expect(html).not.toContain(TOKEN_HASH);
	});

	it("builds the QR payload from the SSID alone", async () => {
		const [device] = await getDevicesForLabels(["dev-a1"]);
		const payload = wifiSetupPayload(provisioningApSsid(device.mac));
		expect(payload).toBe("WIFI:T:nopass;S:PakaonAI-3B09;;");
		expect(payload).not.toContain(TOKEN);
		expect(payload).not.toContain(TOKEN_HASH);
		// No WIFI: password field (P:) is present.
		expect(payload).not.toMatch(/;P:/);
	});
});

describe("sticker content", () => {
	it("prints the rating, unit id, setup steps and an SVG QR", () => {
		const html = renderToStaticMarkup(<DeviceSticker mac="a4:cf:12:7e:3b:09" strings={strings} />);
		const text = html.replace(/<[^>]+>/g, "");
		expect(text).toContain("220 V");
		expect(text).toContain("1.2 A");
		expect(text).toContain("264 VA");
		expect(text).toContain("AC 60 Hz");
		expect(text).toContain("AC supply only");
		expect(html).toContain("A4:CF:12:7E:3B:09");
		expect(html).toContain("192.168.4.1");
		expect(text).toContain("AC input");
		expect(text).not.toContain("DC");
		expect(html).toContain("pakaonai-mark-color-light.svg");
		expect(html).toContain("pakaonai-wordmark-color.svg");
		expect(html).toMatch(/<svg[^>]*viewBox="-4 -4 37 37"/);
		expect(html).not.toContain("<canvas");
		expect(html).not.toContain("data:image");
	});
});
