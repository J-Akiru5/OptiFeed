import { beforeEach, describe, expect, it, vi } from "vitest";

const viewAs = vi.hoisted(() => ({ getViewAsFarmId: vi.fn() }));

vi.mock("@/lib/auth/view-as", () => viewAs);

// with-auth imports session.ts, which pulls in next-intl (cannot load under
// vitest in this configuration). Mock only the i18n leaves.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/auth/verify-session", () => ({
	getVerifiedSession: vi.fn(async () => ({
		sub: "sb-1",
		email: "demo-farmer-1@pond.optifeed.local",
	})),
}));

vi.mock("@/lib/auth/session-cache", () => ({
	getCachedFarm: vi.fn(() => ({ farmId: "demo-farmer-1" })),
	cacheFarm: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: { user: { findUnique: vi.fn() } },
}));

import { withAuth } from "@/lib/auth/with-auth";

const handler = vi.fn(async (_request: Request, context: { ownerId: string }) =>
	Response.json({ ownerId: context.ownerId }),
);

const wrapped = withAuth(handler as never);

function req(method = "GET") {
	return new Request("http://t.local/api/test", { method }) as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	viewAs.getViewAsFarmId.mockResolvedValue(null);
});

describe("withAuth and read-only view-as (plan M5.1)", () => {
	it("keeps the caller's own farm for normal requests", async () => {
		const res = await wrapped(req("GET"));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ownerId: "demo-farmer-1" });
	});

	it("resolves GET reads to the viewed tenant's farm", async () => {
		viewAs.getViewAsFarmId.mockResolvedValue("viewed-farm");

		const res = await wrapped(req("GET"));

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ownerId: "viewed-farm" });
	});

	it("allows HEAD and resolves it to the viewed farm", async () => {
		viewAs.getViewAsFarmId.mockResolvedValue("viewed-farm");

		const res = await wrapped(req("HEAD"));

		expect(res.status).toBe(200);
	});

	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"rejects %s while a view-as session is active, before the handler runs",
		async (method) => {
			viewAs.getViewAsFarmId.mockResolvedValue("viewed-farm");

			const res = await wrapped(req(method));

			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toMatchObject({
				error: { message: "This is a read-only view-as session." },
			});
			expect(handler).not.toHaveBeenCalled();
		},
	);
});
