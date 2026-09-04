import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		pond: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: vi.fn().mockResolvedValue({
		auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

import { buildPondEmail, farmIdFromEmail } from "../auth/session";

describe("buildPondEmail", () => {
	it("builds correct email from farmId", () => {
		expect(buildPondEmail("myfarm")).toBe("myfarm@pond.optifeed.local");
	});

	it("lowercases the farmId", () => {
		expect(buildPondEmail("MyFarm")).toBe("myfarm@pond.optifeed.local");
	});

	it("trims whitespace", () => {
		expect(buildPondEmail("  myfarm  ")).toBe("myfarm@pond.optifeed.local");
	});

	it("handles mixed case with spaces", () => {
		expect(buildPondEmail("  MyFarm  ")).toBe("myfarm@pond.optifeed.local");
	});
});

describe("farmIdFromEmail", () => {
	it("extracts farmId from valid email", () => {
		expect(farmIdFromEmail("myfarm@pond.optifeed.local")).toBe("myfarm");
	});

	it("lowercases the extracted farmId", () => {
		expect(farmIdFromEmail("MyFarm@pond.optifeed.local")).toBe("myfarm");
	});

	it("returns null for undefined", () => {
		expect(farmIdFromEmail(undefined)).toBeNull();
	});

	it("returns null for null", () => {
		expect(farmIdFromEmail(null)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(farmIdFromEmail("")).toBeNull();
	});

	it("returns null for email without @", () => {
		expect(farmIdFromEmail("noatsign")).toBe("noatsign");
	});

	it("returns null for email with empty local part", () => {
		expect(farmIdFromEmail("@pond.optifeed.local")).toBeNull();
	});

	it("handles email with multiple @ symbols", () => {
		expect(farmIdFromEmail("farm@extra@pond.optifeed.local")).toBe("farm");
	});
});
