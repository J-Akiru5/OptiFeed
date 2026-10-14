import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet, cookieSet } = vi.hoisted(() => ({
	cookieGet: vi.fn(),
	cookieSet: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: {
			findMany: vi.fn(),
			findFirst: vi.fn(),
		},
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn().mockResolvedValue("test-farm"),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({ get: cookieGet, set: cookieSet })),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn().mockResolvedValue("en"),
}));

import { redirect } from "@/i18n/routing";
import { switchPond } from "@/lib/actions/pond-selection";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";

const mockPond = vi.mocked(prisma.pond);
const mockRedirect = vi.mocked(redirect);

describe("getActivePond (archived filtering)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cookieGet.mockReturnValue(undefined);
	});

	it("only considers ACTIVE ponds", async () => {
		mockPond.findMany.mockResolvedValue([{ id: "p1", name: "Pond One" }] as never);

		const pond = await getActivePond();

		expect(pond?.id).toBe("p1");
		expect(mockPond.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { ownerId: "test-farm", status: "ACTIVE" } }),
		);
	});

	it("falls back to the first active pond when the cookie points at an archived pond", async () => {
		cookieGet.mockReturnValue({ value: "archived-pond" });
		mockPond.findMany.mockResolvedValue([{ id: "active-1", name: "Active" }] as never);

		const pond = await getActivePond();

		expect(pond?.id).toBe("active-1");
	});

	it("returns null when all ponds are archived", async () => {
		mockPond.findMany.mockResolvedValue([] as never);
		expect(await getActivePond()).toBeNull();
	});
});

describe("switchPond (archived filtering)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("refuses to select an archived pond", async () => {
		mockPond.findFirst.mockResolvedValue(null);

		await expect(switchPond("archived-pond")).rejects.toThrow("Pond not found or access denied");
		expect(mockPond.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "archived-pond", ownerId: "test-farm", status: "ACTIVE" },
			}),
		);
		expect(cookieSet).not.toHaveBeenCalled();
	});

	it("sets the cookie and redirects for an active pond", async () => {
		mockPond.findFirst.mockResolvedValue({ id: "p1" } as never);

		await switchPond("p1");

		expect(cookieSet).toHaveBeenCalledWith(
			"optifeed:pondId",
			"p1",
			expect.objectContaining({ httpOnly: true, path: "/" }),
		);
		expect(mockRedirect).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
	});
});
