import { beforeEach, describe, expect, it, vi } from "vitest";

// session.ts (and therefore with-auth.ts) pulls in next-intl, which cannot
// load under vitest. Mock only the i18n leaves so the real auth logic runs.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/session")>();
	return { ...actual, requireWriteAccess: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		pond: { findMany: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findMany: vi.fn() },
		fishSample: { createMany: vi.fn() },
		deviceStateEvent: { create: vi.fn() },
	},
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as confirmPost } from "@/app/api/import/confirm/route";
import { requireWriteAccess } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockCreateClient = vi.mocked(createClient);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockPondFindMany = vi.mocked(prisma.pond.findMany);
const mockEnergyDeviceFindFirst = vi.mocked(prisma.energyDevice.findFirst);
const mockBiomassLogFindMany = vi.mocked(prisma.biomassLog.findMany);
const mockFishSampleCreateMany = vi.mocked(prisma.fishSample.createMany);

const FISH_CSV = "biomassLogId,weightGrams,lengthCm\nlog-1,120,24\nlog-2,95,21";

function confirmReq(csvData: string) {
	return new Request("http://test.local/api/import/confirm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "fish_samples", csvData }),
	}) as never;
}

describe("fish_samples import enforces biomassLogId ownership (F-004)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateClient.mockResolvedValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" } },
				}),
			},
		} as never);
		mockUserFindUnique.mockResolvedValue({
			farmId: "demo-farmer-1",
			supabaseId: "sb-1",
			role: "ADMIN",
		} as never);
		mockRequireWriteAccess.mockResolvedValue(undefined as never);
		mockPondFindMany.mockResolvedValue([
			{ id: "pond-1", ownerId: "demo-farmer-1", status: "ACTIVE" },
		] as never);
		mockEnergyDeviceFindFirst.mockResolvedValue({ id: "dev-1" } as never);
		mockFishSampleCreateMany.mockResolvedValue({ count: 2 } as never);
	});

	it("rejects a biomassLogId owned by another farm and writes nothing", async () => {
		// The referenced logs exist but belong to someone else's pond, so the
		// ownership-scoped lookup returns no rows for this caller.
		mockBiomassLogFindMany.mockResolvedValue([] as never);

		const res = await confirmPost(confirmReq(FISH_CSV));

		expect(res.status).toBe(400);
		expect(mockBiomassLogFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ["log-1", "log-2"] },
					pond: { ownerId: "demo-farmer-1" },
				}),
			}),
		);
		expect(mockFishSampleCreateMany).not.toHaveBeenCalled();
	});

	it("imports when every referenced biomassLogId belongs to the caller", async () => {
		mockBiomassLogFindMany.mockResolvedValue([{ id: "log-1" }, { id: "log-2" }] as never);

		const res = await confirmPost(confirmReq(FISH_CSV));

		expect(res.status).toBe(200);
		expect(mockFishSampleCreateMany).toHaveBeenCalledTimes(1);
	});

	it("rejects when only some referenced biomassLogIds are owned (no partial write)", async () => {
		// log-1 is the caller's, log-2 is foreign — one missing row fails the check.
		mockBiomassLogFindMany.mockResolvedValue([{ id: "log-1" }] as never);

		const res = await confirmPost(confirmReq(FISH_CSV));

		expect(res.status).toBe(400);
		expect(mockFishSampleCreateMany).not.toHaveBeenCalled();
	});
});
