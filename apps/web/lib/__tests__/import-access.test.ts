import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
	farmIdFromEmail: (email?: string | null) =>
		email ? (email.split("@")[0]?.toLowerCase() ?? null) : null,
	requireWriteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findFirst: vi.fn() },
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
const mockPond = vi.mocked(prisma.pond);

function postBody(url: string): Request {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "biomass_logs", csvData: "sampleWeightKg,sampleCount\n10,5" }),
	});
}

describe("import routes enforce write access (1.5)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateClient.mockResolvedValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { email: "viewer@pond.optifeed.local" } },
				}),
			},
		} as never);
		mockRequireWriteAccess.mockRejectedValue(
			new Error("Write access required (ADMIN or OPERATOR)"),
		);
	});

	it("POST /api/import returns 403 for VIEWER before touching the database", async () => {
		const res = await importPost(postBody("http://test.local/api/import"));
		expect(res.status).toBe(403);
		expect(mockPond.findFirst).not.toHaveBeenCalled();
	});

	it("POST /api/import/confirm returns 403 for VIEWER before touching the database", async () => {
		const res = await confirmPost(postBody("http://test.local/api/import/confirm"));
		expect(res.status).toBe(403);
		expect(mockPond.findFirst).not.toHaveBeenCalled();
	});
});
