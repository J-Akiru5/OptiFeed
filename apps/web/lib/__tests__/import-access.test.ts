import { beforeEach, describe, expect, it, vi } from "vitest";

// session.ts (and therefore with-auth.ts) pulls in next-intl, which cannot
// load under vitest. Mock only the i18n leaves so the real auth logic runs.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/session")>();
	return {
		...actual,
		requireWriteAccess: vi.fn(),
	};
});

vi.mock("@/lib/supabase/server", () => ({
	createClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		pond: { findMany: vi.fn(), findFirst: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
	},
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import { POST as confirmPost } from "@/app/api/import/confirm/route";
import { POST as importPost } from "@/app/api/import/route";
import { requireWriteAccess } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockCreateClient = vi.mocked(createClient);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockPondFindMany = vi.mocked(prisma.pond.findMany);

function postBody(url: string): Request {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "biomass_logs", csvData: "sampleWeightKg,sampleCount\n10,5" }),
	});
}

// withAuth handlers take NextRequest; a plain Request satisfies them at runtime.
function nextReq(url: string) {
	return postBody(url) as never;
}

describe("import routes enforce write access (1.5)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// withAuth passes: a real session whose email domain matches the DB row.
		mockCreateClient.mockResolvedValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: "sb-viewer", email: "viewer@pond.optifeed.local" } },
				}),
			},
		} as never);
		mockUserFindUnique.mockResolvedValue({ farmId: "viewer", supabaseId: "sb-viewer" } as never);
		// requireWriteAccess rejects: the user is a VIEWER.
		mockRequireWriteAccess.mockRejectedValue(
			new Error("Write access required (ADMIN or OPERATOR)"),
		);
	});

	it("POST /api/import returns 403 for VIEWER before touching the database", async () => {
		const res = await importPost(nextReq("http://test.local/api/import"));
		expect(res.status).toBe(403);
		expect(mockPondFindMany).not.toHaveBeenCalled();
	});

	it("POST /api/import/confirm returns 403 for VIEWER before touching the database", async () => {
		const res = await confirmPost(nextReq("http://test.local/api/import/confirm"));
		expect(res.status).toBe(403);
		expect(mockPondFindMany).not.toHaveBeenCalled();
	});
});
